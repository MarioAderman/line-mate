import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_PLAN,
  BASELINE_SCENARIO_ID,
  HUMAN_DECISION,
  PART_DELAY,
  type Plan,
} from "@/domain";
import { COMMAND_NAMES, createInitialState, createMemoryContext, executeCommand } from "@/commands";
import { simulate } from "@/simulation";
import {
  explorationStubSnapshots,
  explorationStubSummary,
} from "@/components/story/explorationStub";
import { IDLE_EXPLORATION, useWorkshopStore } from "./workshopStore";
import {
  DEFAULT_NOTE_TEXT,
  NOTE_CHANNELS,
  NOTE_RECIPIENTS,
  applyAndNotify,
  planChangeInput,
  proposal,
  proposedPlan,
  reset,
  startEscalation,
  startExploration,
  type StoryCommandLog,
} from "./storySlice";

/** Beats attempt commands two other streams are still building. */
function pending(log: StoryCommandLog[]): string[] {
  return log.filter((entry) => !COMMAND_NAMES.includes(entry.name)).map((entry) => entry.name);
}

/** Every command that already exists must have succeeded. */
function expectLandedCommandsOk(log: StoryCommandLog[]): void {
  const failures = log.filter((entry) => COMMAND_NAMES.includes(entry.name) && !entry.ok);
  expect(failures).toEqual([]);
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
  };
}

beforeEach(() => {
  useWorkshopStore.setState(view("escalated"));
});

describe("beat 2 — escalation", () => {
  it("injects the part delay and re-runs the shift, attributed to the simulation", () => {
    useWorkshopStore.setState(view("calm"));
    const result = startEscalation();

    expect(names(result.commands)).toEqual(["inject_event", "run_simulation"]);
    expect(result.commands[0].input).toEqual({ disruption: PART_DELAY });
    expectLandedCommandsOk(result.commands);
    expect(useWorkshopStore.getState().story).toBe("escalation");
    expect(useWorkshopStore.getState().changes[0]).toMatchObject({
      actor: "simulation",
      command: "run_simulation",
    });
  });

  it("only leaves inject_event pending on engine-explorer", () => {
    useWorkshopStore.setState(view("calm"));
    expect(pending(startEscalation().commands)).toEqual(["inject_event"]);
  });
});

describe("beat 3 — exploration", () => {
  it("streams progress into the store and ends on the 6/6 candidate", async () => {
    const seen: number[] = [];
    const unsubscribe = useWorkshopStore.subscribe((state) => {
      if (state.exploration.status === "running") seen.push(state.exploration.runsExecuted);
    });
    const result = await startExploration({ tickMs: 0 });
    unsubscribe();

    expect(useWorkshopStore.getState().story).toBe("running");
    expect(seen.length).toBeGreaterThan(10);
    // The counter only ever climbs.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);

    const exploration = useWorkshopStore.getState().exploration;
    expect(exploration.status).toBe("done");
    expect(exploration.rows).toHaveLength(6);
    expect(exploration.rows.every((row) => row.progress === 1)).toBe(true);
    expect(exploration.runsExecuted).toBe(288);
    expect(exploration.best).toMatchObject({
      label: "SUV first into Bay 3 at 15:30",
      promisesMet: 6,
      promisedTotal: 6,
      promisesMetRate: 0.94,
      constraintViolations: [],
    });
    expect(result.summary?.candidatesEvaluated).toBe(36);
    expect(result.cancelled).toBe(false);
  });

  it("records the run through the command layer once explore_schedules lands", async () => {
    const result = await startExploration({ tickMs: 0 });
    expect(names(result.commands)).toEqual(["explore_schedules"]);
    expect(result.commands[0].input).toEqual({
      scenarioId: BASELINE_SCENARIO_ID,
      seed: 20260829,
      replications: 8,
    });
  });

  it("does not double-search when a real runner is injected", async () => {
    const result = await startExploration({
      tickMs: 0,
      runner: async ({ scenarioId }) => explorationStubSummary(scenarioId),
    });
    expect(result.commands).toEqual([]);
    expect(useWorkshopStore.getState().exploration.best?.promisesMet).toBe(6);
  });

  it("cancels the previous run when a second one starts", async () => {
    const first = startExploration({ tickMs: 1 });
    const second = startExploration({ tickMs: 0 });
    expect((await first).cancelled).toBe(true);
    expect((await second).cancelled).toBe(false);
  });

  it("replays the same deterministic script every take", () => {
    expect(explorationStubSnapshots()).toEqual(explorationStubSnapshots());
    const snapshots = explorationStubSnapshots();
    expect(snapshots[0]).toMatchObject({ status: "running", runsExecuted: 0, best: null });
    expect(snapshots[snapshots.length - 1]).toMatchObject({ status: "done", runsExecuted: 288 });
  });
});

describe("beat 4 — proposal", () => {
  it("proposes the winning candidate as the plan, without touching the world", async () => {
    await startExploration({ tickMs: 0 });
    const changesBefore = useWorkshopStore.getState().changes.length;
    const result = proposal();

    expect(result.commands).toEqual([]);
    expect(useWorkshopStore.getState().story).toBe("proposal");
    expect(useWorkshopStore.getState().changes).toHaveLength(changesBefore);
    expect(result.plan?.changes).toEqual([...AGENT_PLAN.changes, ...HUMAN_DECISION.changes]);
  });

  it("refuses a beat that is out of order", () => {
    useWorkshopStore.setState(view("calm"));
    proposal();
    expect(useWorkshopStore.getState().story).toBe("calm");
  });
});

describe("beat 5 — apply and notify", () => {
  async function runToResolved() {
    startEscalation();
    await startExploration({ tickMs: 0 });
    proposal();
    return applyAndNotify();
  }

  it("branches off the baseline, applies, re-runs and posts the note", async () => {
    const result = await runToResolved();

    expect(names(result.commands).slice(0, 1)).toEqual(["create_scenario"]);
    expect(names(result.commands).slice(-2)).toEqual(["run_simulation", "post_shift_note"]);
    expectLandedCommandsOk(result.commands);
    expect(useWorkshopStore.getState().story).toBe("resolved");

    const note = result.commands[result.commands.length - 1];
    expect(note.input).toEqual({
      text: DEFAULT_NOTE_TEXT,
      channels: NOTE_CHANNELS,
      recipients: NOTE_RECIPIENTS,
    });
  });

  it("keeps every promise on the branch and leaves the baseline alone", async () => {
    await runToResolved();
    const state = useWorkshopStore.getState();

    expect(state.activeScenarioId).not.toBe(BASELINE_SCENARIO_ID);
    expect(state.simulations[state.activeScenarioId].totals.promisesMet).toBe(6);

    const baseline = state.scenarios.find((s) => s.id === BASELINE_SCENARIO_ID)!;
    expect(simulate(baseline).totals.promisesMet).toBe(4);
    expect(baseline.workItems.find((w) => w.id === "veh-03")!.route).toEqual({
      resourceId: null,
      position: null,
    });
  });

  it("attributes the application to whoever applied it", async () => {
    startEscalation();
    await startExploration({ tickMs: 0 });
    proposal();
    applyAndNotify(undefined, DEFAULT_NOTE_TEXT, { actor: "agent" });
    const applied = useWorkshopStore
      .getState()
      .changes.filter((c) => c.command === "route_work_item");
    expect(applied.every((c) => c.actor === "agent")).toBe(true);
  });

  it("says so when there is no plan yet", () => {
    useWorkshopStore.setState({ ...view("escalated"), story: "proposal" });
    const result = applyAndNotify();
    expect(result.ok).toBe(false);
    expect(result.commands).toEqual([
      { name: "apply_plan", input: null, ok: false, error: expect.any(String) },
    ]);
  });
});

describe("the command path", () => {
  it("applies the proposed plan through executeCommand alone and reaches 6/6", () => {
    const plan: Plan = {
      id: "PLAN-EXP-05",
      label: "SUV first into Bay 3 at 15:30",
      changes: [...AGENT_PLAN.changes, ...HUMAN_DECISION.changes],
    };
    const ctx = createMemoryContext("agent");
    expect(executeCommand(ctx, "create_scenario", { name: "Human + agent" }).ok).toBe(true);
    for (const change of plan.changes) {
      expect(executeCommand(ctx, change.command, planChangeInput(change)).ok).toBe(true);
    }
    const result = executeCommand(ctx, "run_simulation", {});
    expect(result.ok).toBe(true);
    expect(ctx.state.simulations[ctx.state.activeScenarioId].totals.promisesMet).toBe(6);
    expect(ctx.state.changes.every((c) => c.actor === "agent" || c.command === "load_fixture")).toBe(
      true,
    );
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
  it("returns to the calm shop with the story view state cleared", async () => {
    startEscalation();
    await startExploration({ tickMs: 0 });
    proposal();
    applyAndNotify();

    reset();
    const state = useWorkshopStore.getState();
    expect(state.story).toBe("calm");
    expect(state.view).toBe("board");
    expect(state.exploration).toEqual(IDLE_EXPLORATION);
    expect(state.notes).toEqual([]);
    expect(state.scenarios).toHaveLength(1);
    expect(state.activeScenarioId).toBe(BASELINE_SCENARIO_ID);
    expect(state.scenarios[0].resources.find((r) => r.id === "bay-3")!.status).toBe("idle");
    expect(simulate(state.scenarios[0]).totals.promisesMet).toBe(6);
    expect(proposedPlan(state)).toBeNull();
  });

  it("survives a second full take", async () => {
    reset();
    startEscalation();
    await startExploration({ tickMs: 0 });
    proposal();
    applyAndNotify();
    expect(useWorkshopStore.getState().story).toBe("resolved");
  });
});
