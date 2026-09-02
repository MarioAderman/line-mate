import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_PLAN,
  BASELINE_SCENARIO_ID,
  HUMAN_DECISION,
  PART_DELAY,
  type ExplorationSummary,
  type Plan,
  type Scenario,
} from "@/domain";
import { COMMAND_NAMES, createInitialState, createMemoryContext, executeCommand } from "@/commands";
import { simulate } from "@/simulation";
import { WEBMCP_TOOL_NAMES } from "@/webmcp";
import { exploreSchedules, rankCandidates } from "@/simulation";
import { IDLE_EXPLORATION, useWorkshopStore } from "./workshopStore";
import {
  DEFAULT_NOTE_TEXT,
  NOTE_CHANNELS,
  NOTE_RECIPIENTS,
  applyAndNotify,
  draftPlan,
  planChangeInput,
  progressFromSummary,
  proposal,
  reset,
  routeFromDrop,
  startEscalation,
  startExploration,
  type StoryCommandLog,
} from "./storySlice";

/** Every command that already exists must have succeeded. */
function expectLandedCommandsOk(log: StoryCommandLog[]): void {
  expect(log.filter((e) => COMMAND_NAMES.includes(e.name) && !e.ok)).toEqual([]);
}

function names(log: StoryCommandLog[]): string[] {
  return log.map((entry) => entry.name);
}

function view(story: "calm" | "escalated") {
  return {
    ...createInitialState({ story }),
    selection: null,
    playbackMinute: null,
    agentAttention: null,
    lastResult: null,
    view: "board" as const,
    story: story === "calm" ? ("calm" as const) : ("escalation" as const),
    exploration: IDLE_EXPLORATION,
    popover: null,
    draft: null,
    humanEdited: [],
    applyError: null,
  };
}

function baseline(): Scenario {
  const state = useWorkshopStore.getState();
  return state.scenarios.find((s) => s.id === BASELINE_SCENARIO_ID)!;
}

/** Beats 3 and 4, with no command available to fail on. */
async function explore() {
  return startExploration({ tickMs: 0 });
}

beforeEach(() => {
  useWorkshopStore.setState(view("escalated"));
});

describe("beat 2 — escalation", () => {
  it("sends the disruption through the command layer", () => {
    useWorkshopStore.setState(view("calm"));
    const result = startEscalation();
    expect(names(result.commands)[0]).toBe("inject_event");
    expect(result.commands[0].input).toEqual({ disruption: PART_DELAY });
  });

  it("does not move the screen when the injection fails", () => {
    useWorkshopStore.setState(view("calm"));
    const result = startEscalation();
    // TODO(engine): inject_event is engine-explorer's; until it lands the beat
    // must refuse to pretend the delay happened.
    if (COMMAND_NAMES.includes("inject_event")) {
      expect(result.ok).toBe(true);
      expect(useWorkshopStore.getState().story).toBe("escalation");
    } else {
      expect(result.ok).toBe(false);
      expect(result.error).toContain("inject_event");
      expect(useWorkshopStore.getState().story).toBe("calm");
      // It also must not run a simulation of a world it failed to change.
      expect(names(result.commands)).toEqual(["inject_event"]);
    }
  });
});

describe("beat 3 — exploration", () => {
  it("runs exactly one search and displays exactly that summary", async () => {
    const result = await explore();
    expect(names(result.commands).filter((n) => n === "explore_schedules")).toHaveLength(1);
    expect(result.summary).not.toBeNull();
    // The invariant: the panel state is a pure function of the returned summary.
    expect(useWorkshopStore.getState().exploration).toEqual(
      progressFromSummary(result.summary as ExplorationSummary),
    );
  });

  it("serves the search from the one attributed command", async () => {
    const result = await explore();
    expect(result.servedBy).toBe("command");
    // Exactly one attributed search in the world's history.
    const searches = useWorkshopStore
      .getState()
      .changes.filter((c) => c.command === "explore_schedules");
    expect(searches).toHaveLength(1);
    expect(searches[0].actor).toBe("agent");
  });

  it("measures every candidate instead of declaring a figure", async () => {
    const result = await explore();
    const summary = result.summary as ExplorationSummary;
    // The panel's numbers are the engine's own accounting of the one search.
    expect(summary.candidatesEvaluated).toBeGreaterThan(50);
    expect(summary.runsExecuted).toBe(summary.candidatesEvaluated * summary.replications);
    // Rates are shares of whole runs, never a decorative constant.
    for (const candidate of summary.top) {
      expect(candidate.promisesMetRate * summary.replications).toBeCloseTo(
        Math.round(candidate.promisesMetRate * summary.replications),
      );
    }
    // The ranking is the stated objective applied to what was measured.
    expect([...summary.top].sort(rankCandidates)).toEqual(summary.top);
    expect(summary.best).toEqual(summary.top[0]);
    // And the winner is measured perfect: 6/6 in every seeded world.
    expect(summary.best?.promisesMet).toBe(6);
    expect(summary.best?.promisesMetRate).toBe(1);
  });

  it("reproduces the same measurement every run", () => {
    const scenario = baseline();
    const a = exploreSchedules(scenario, { seed: 7 });
    const b = exploreSchedules(scenario, { seed: 7 });
    expect(a).toEqual(b);
  });

  it("streams progress while it searches", async () => {
    const seen: number[] = [];
    const unsubscribe = useWorkshopStore.subscribe((state) => {
      if (state.exploration.status === "running") seen.push(state.exploration.runsExecuted);
    });
    await explore();
    unsubscribe();
    expect(seen.length).toBeGreaterThan(10);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("goes back to the beat it came from when the search fails", async () => {
    const result = await startExploration({
      tickMs: 0,
      runner: async () => {
        throw new Error("engine exploded");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("engine exploded");
    expect(useWorkshopStore.getState().story).toBe("escalation");
    expect(useWorkshopStore.getState().exploration).toEqual(IDLE_EXPLORATION);
  });

  it("cancels the previous run when a second one starts", async () => {
    const first = startExploration({ tickMs: 1 });
    const second = startExploration({ tickMs: 0 });
    expect((await first).cancelled).toBe(true);
    expect((await second).cancelled).toBe(false);
  });
});

describe("beat 4 — the draft", () => {
  it("holds the proposal as data and touches no scenario", async () => {
    await explore();
    const before = structuredClone(baseline());
    const changesBefore = useWorkshopStore.getState().changes.length;

    const result = proposal();
    routeFromDrop("veh-03", "bay-3", 1);

    expect(result.plan).not.toBeNull();
    expect(useWorkshopStore.getState().story).toBe("proposal");
    // Beats 3 and 4 leave the protected baseline byte-identical.
    expect(baseline()).toEqual(before);
    expect(useWorkshopStore.getState().changes).toHaveLength(changesBefore);
    expect(useWorkshopStore.getState().scenarios).toHaveLength(1);
  });

  it("keeps a human retarget instead of overwriting it", async () => {
    await explore();
    proposal();
    routeFromDrop("veh-03", "bay-3", 1);
    routeFromDrop("veh-03", "bay-1", 2);

    const routes = draftPlan()!.changes.filter(
      (c) => c.command === "route_work_item" && c.workItemId === "veh-03",
    );
    expect(routes).toEqual([
      { command: "route_work_item", workItemId: "veh-03", resourceId: "bay-1", position: 2 },
    ]);
    expect(useWorkshopStore.getState().humanEdited).toEqual(["veh-03"]);
  });

  it("applies exactly the draft that was on screen", async () => {
    await explore();
    proposal();
    routeFromDrop("veh-03", "bay-3", 1);
    const onScreen = structuredClone(draftPlan()!);

    const applied = applyAndNotify();
    // Finding 4: apply_plan receives a deep-equal copy of the edited draft.
    const sent = applied.commands.find((c) => c.name === "apply_plan");
    expect(sent).toBeDefined();
    expect((sent!.input as { plan: Plan }).plan).toEqual(onScreen);
    expect(applied.ok).toBe(true);
  });

  it("refuses to propose without a search", () => {
    const result = proposal();
    expect(result.ok).toBe(false);
    expect(useWorkshopStore.getState().story).toBe("escalation");
  });

  it("routes to the world, not the draft, outside beat 4", () => {
    routeFromDrop("veh-01", "bay-1", 1);
    const changes = useWorkshopStore.getState().changes;
    expect(names(changes.map((c) => ({ name: c.command }) as never))).toBeDefined();
    // The drop lands in the world as the human's change, and the store answers
    // it right away with a re-simulation attributed to the engine.
    expect(changes[1]).toMatchObject({ command: "route_work_item", actor: "human" });
    expect(changes[0]).toMatchObject({ command: "run_simulation", actor: "simulation" });
  });
});

describe("beat 5 — apply and notify", () => {
  async function runToApply() {
    await explore();
    proposal();
    return applyAndNotify();
  }

  it("branches, applies and verifies before claiming anything", async () => {
    const result = await runToApply();
    expect(names(result.commands)[0]).toBe("create_scenario");
    expectLandedCommandsOk(result.commands);

    const state = useWorkshopStore.getState();
    expect(state.activeScenarioId).not.toBe(BASELINE_SCENARIO_ID);
    // The branch really keeps every promise…
    expect(state.simulations[state.activeScenarioId].totals.promisesMet).toBe(6);
    // …and the baseline is still the failing shift.
    expect(simulate(baseline()).totals.promisesMet).toBe(4);
  });

  it("does not resolve while the note cannot be stored", async () => {
    const result = await runToApply();
    if (COMMAND_NAMES.includes("post_shift_note")) {
      expect(result.ok).toBe(true);
      expect(useWorkshopStore.getState().story).toBe("resolved");
      expect(useWorkshopStore.getState().notes).not.toHaveLength(0);
    } else {
      // TODO(engine): post_shift_note is engine-explorer's. No note, no
      // "team notified" — the beat stays where it is.
      expect(result.ok).toBe(false);
      expect(result.error).toContain("post_shift_note");
      expect(useWorkshopStore.getState().story).toBe("proposal");
      expect(useWorkshopStore.getState().notes).toEqual([]);
    }
    expect(names(result.commands)).toContain("post_shift_note");
    const note = result.commands.find((c) => c.name === "post_shift_note")!;
    expect(note.input).toEqual({
      text: DEFAULT_NOTE_TEXT,
      channels: NOTE_CHANNELS,
      recipients: NOTE_RECIPIENTS,
    });
  });

  it("stays on the proposal when a change is rejected", async () => {
    await explore();
    proposal({
      id: "PLAN-BROKEN",
      label: "Broken",
      changes: [{ command: "route_work_item", workItemId: "veh-99", resourceId: null, position: null }],
    });
    const result = applyAndNotify();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("veh-99");
    expect(useWorkshopStore.getState().story).toBe("proposal");
  });

  it("refuses to resolve a plan that misses a promise", async () => {
    await explore();
    // A plan that does nothing useful: the shift still misses two promises.
    proposal({
      id: "PLAN-WEAK",
      label: "Weak",
      changes: [{ command: "update_work_item", workItemId: "veh-07", priority: 1 }],
    });
    const result = applyAndNotify();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/keeps \d of 6 promises/);
    expect(useWorkshopStore.getState().story).toBe("proposal");
    expect(useWorkshopStore.getState().notes).toEqual([]);
  });

  it("says so when there is no plan at all", () => {
    useWorkshopStore.setState({ ...view("escalated"), story: "proposal" });
    const result = applyAndNotify();
    expect(result.ok).toBe(false);
    expect(result.commands).toEqual([]);
    expect(result.error).toContain("No plan to apply");
  });
});

describe("the command path", () => {
  it("applies the demo plan through executeCommand alone and reaches 6/6", () => {
    const plan: Plan = {
      id: "PLAN-DEMO",
      label: "Human + agent",
      changes: [...AGENT_PLAN.changes, ...HUMAN_DECISION.changes],
    };
    const ctx = createMemoryContext("agent");
    expect(executeCommand(ctx, "create_scenario", { name: "Human + agent" }).ok).toBe(true);
    for (const change of plan.changes) {
      expect(executeCommand(ctx, change.command, planChangeInput(change)).ok).toBe(true);
    }
    expect(executeCommand(ctx, "run_simulation", {}).ok).toBe(true);
    expect(ctx.state.simulations[ctx.state.activeScenarioId].totals.promisesMet).toBe(6);
  });

  it("refuses to let the agent edit the baseline in place", () => {
    const ctx = createMemoryContext("agent");
    const result = executeCommand(ctx, "route_work_item", {
      workItemId: "veh-03",
      resourceId: "bay-3",
      position: 1,
    });
    expect(result.ok).toBe(false);
  });
});

describe("reset", () => {
  it("rebuilds the world through reset_demo and clears only view state", async () => {
    await explore();
    proposal();
    routeFromDrop("veh-03", "bay-3", 1);
    useWorkshopStore.getState().setMcpStatus("linked", 10);

    const result = reset();
    expect(result.ok).toBe(true);
    expect(names(result.commands)).toEqual(["reset_demo"]);

    const state = useWorkshopStore.getState();
    expect(state.story).toBe("calm");
    expect(state.exploration).toEqual(IDLE_EXPLORATION);
    expect(draftPlan()).toBeNull();
    expect(state.notes).toEqual([]);
    expect(state.scenarios).toHaveLength(1);
    expect(state.scenarios[0].resources.find((r) => r.id === "bay-3")!.status).toBe("idle");
    expect(simulate(state.scenarios[0]).totals.promisesMet).toBe(6);
    // The WebMCP link describes the room, not the story: it survives a reset.
    expect(state.mcpStatus).toBe("linked");
  });

  it("keeps the demo reset out of the agent's hands", () => {
    const ctx = createMemoryContext("agent");
    expect(executeCommand(ctx, "reset_demo", { story: "calm" }).ok).toBe(false);
    expect([...WEBMCP_TOOL_NAMES]).not.toContain("reset_demo");
  });

  it("puts the next take back at the start of the beat order", async () => {
    reset();
    // From calm the search is not the next beat: the delay has to land first,
    // and nothing should be computed or drafted meanwhile.
    const searched = await explore();
    expect(searched.ok).toBe(false);
    expect(searched.summary).toBeNull();
    expect(useWorkshopStore.getState().story).toBe("calm");
    expect(useWorkshopStore.getState().exploration).toEqual(IDLE_EXPLORATION);
    expect(proposal().ok).toBe(false);
    expect(draftPlan()).toBeNull();
  });

  it("runs a whole second take once the escalation is back", async () => {
    reset();
    startEscalation();
    const searched = await explore();
    expect(searched.ok).toBe(true);
    expect(proposal().ok).toBe(true);
    expect(useWorkshopStore.getState().story).toBe("proposal");
    expect(draftPlan()).not.toBeNull();
  });
});
