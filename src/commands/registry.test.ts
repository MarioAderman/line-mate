import { describe, expect, it } from "vitest";
import {
  AGENT_PLAN,
  BASELINE_SCENARIO_ID,
  HUMAN_DECISION,
  PART_DELAY,
  planFromBeat,
  workshopFixture,
  type DemoBeat,
  type ExplorationSummary,
  type ShiftNote,
} from "@/domain";
import { simulate } from "@/simulation";
import { createInitialState, createMemoryContext, type CommandContext } from "./state";
import { COMMAND_NAMES, executeCommand, type MutationReceipt } from "./registry";

const AGENT_TOOLS = [
  "inspect_system",
  "inspect_resource",
  "inspect_work_item",
  "get_simulation_results",
  "compare_scenarios",
  "create_scenario",
  "update_resource",
  "update_work_item",
  "route_work_item",
  "apply_plan",
  "post_shift_note",
  "run_simulation",
  "explore_schedules",
];

/** Commands the person at the screen drives; never registered for the agent. */
const HUMAN_ONLY = ["activate_scenario", "inject_event", "reset_demo"];

function ok<T = Record<string, unknown>>(result: ReturnType<typeof executeCommand>): T {
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result.data as T;
}

function fail(result: ReturnType<typeof executeCommand>): string {
  if (result.ok) throw new Error("expected failure, got success");
  return result.error;
}

function applyBeat(ctx: CommandContext, beat: DemoBeat, scenarioId: string) {
  for (const change of beat.changes) {
    const input =
      change.command === "update_work_item"
        ? { workItemId: change.workItemId, changes: { priority: change.priority }, scenarioId }
        : { workItemId: change.workItemId, resourceId: change.resourceId, position: change.position, scenarioId };
    ok(executeCommand(ctx, change.command, input));
  }
}

describe("registry", () => {
  it("exposes the thirteen agent tools plus the human-only commands", () => {
    expect(AGENT_TOOLS).toHaveLength(13);
    expect([...COMMAND_NAMES].sort()).toEqual([...AGENT_TOOLS, ...HUMAN_ONLY].sort());
  });

  it("rejects unknown commands without throwing", () => {
    expect(fail(executeCommand(createMemoryContext(), "drop_database", {}))).toContain("Unknown command");
  });

  it("rejects malformed input with a readable message", () => {
    const error = fail(
      executeCommand(createMemoryContext(), "update_work_item", {
        workItemId: "veh-01",
        changes: { priority: 0 },
      }),
    );
    expect(error).toContain("Invalid input");
    expect(error).toContain("priority");
  });
});

describe("reads", () => {
  it("inspect_system summarises the floor and flags a stale simulation", () => {
    const data = ok<{
      scenario: { id: string; clock: { now: string; closes: string } };
      resources: unknown[];
      technicians: unknown[];
      workItems: { promisedBy: string | null }[];
      simulationStale: boolean;
    }>(executeCommand(createMemoryContext(), "inspect_system", {}));
    expect(data.scenario.id).toBe(BASELINE_SCENARIO_ID);
    expect(data.scenario.clock).toMatchObject({ now: "14:15", closes: "18:00" });
    expect(data.resources).toHaveLength(4);
    expect(data.technicians).toHaveLength(3);
    expect(data.workItems.filter((w) => w.promisedBy !== null)).toHaveLength(6);
    expect(data.simulationStale).toBe(true);
  });

  it("inspect_resource explains why Bay 3 is blocked and who is queued there", () => {
    const data = ok<{ resource: { status: string; blockedUntil: string }; routedWorkItems: { id: string }[] }>(
      executeCommand(createMemoryContext(), "inspect_resource", { resourceId: "bay-3" }),
    );
    expect(data.resource.status).toBe("blocked");
    expect(data.resource.blockedUntil).toBe("15:30");
    expect(data.routedWorkItems.map((w) => w.id)).toEqual(["veh-12", "veh-05"]);
  });

  it("inspect_work_item lists steps, skills, and a feasibility signal", () => {
    const data = ok<{ steps: { technicians: string[] }[]; feasibility: { slackMinutes: number; blockedRoute: boolean } }>(
      executeCommand(createMemoryContext(), "inspect_work_item", { workItemId: "veh-05" }),
    );
    expect(data.steps[0].technicians).toEqual(["Carlos"]);
    expect(data.feasibility.blockedRoute).toBe(true);
    expect(data.feasibility.slackMinutes).toBe(225 - 90);
  });

  it("get_simulation_results refuses before a run and answers after", () => {
    const ctx = createMemoryContext();
    expect(fail(executeCommand(ctx, "get_simulation_results", {}))).toContain("run_simulation");
    ok(executeCommand(ctx, "run_simulation", {}));
    const data = ok<{ totals: { promisesMet: number }; timeline: { events: number } }>(
      executeCommand(ctx, "get_simulation_results", {}),
    );
    expect(data.totals.promisesMet).toBe(4);
    expect(data.timeline.events).toBeGreaterThan(0);
  });

  it("bounds the timeline unless asked for it", () => {
    const ctx = createMemoryContext();
    const summary = ok<{ timeline: unknown }>(executeCommand(ctx, "run_simulation", {}));
    expect(Array.isArray(summary.timeline)).toBe(false);
    const full = ok<{ timeline: unknown[] }>(
      executeCommand(ctx, "get_simulation_results", { includeTimeline: true }),
    );
    expect(Array.isArray(full.timeline)).toBe(true);
    expect(full.timeline.length).toBeLessThanOrEqual(200);
  });

  it("surfaces unknown ids as errors listing the known ones", () => {
    const error = fail(executeCommand(createMemoryContext(), "inspect_resource", { resourceId: "bay-9" }));
    expect(error).toContain("bay-9");
    expect(error).toContain("bay-1");
  });
});

describe("baseline protection", () => {
  it("refuses agent mutations on the baseline and points to create_scenario", () => {
    const ctx = createMemoryContext("agent");
    const error = fail(
      executeCommand(ctx, "update_work_item", { workItemId: "veh-01", changes: { priority: 1 } }),
    );
    expect(error).toContain("create_scenario");
    expect(ctx.state.scenarios[0].workItems[0].priority).toBe(3);
  });

  it("lets the agent edit the baseline only with an explicit allowance", () => {
    const ctx = createMemoryContext("agent");
    ok(
      executeCommand(ctx, "update_work_item", {
        workItemId: "veh-01",
        changes: { priority: 1 },
        allowBaselineEdit: true,
      }),
    );
    expect(ctx.state.scenarios[0].workItems[0].priority).toBe(1);
  });

  it("lets the human edit the baseline directly", () => {
    const ctx = createMemoryContext("human");
    ok(executeCommand(ctx, "update_work_item", { workItemId: "veh-01", changes: { priority: 1 } }));
    expect(ctx.state.changes[0].actor).toBe("human");
  });
});

describe("mutations", () => {
  it("create_scenario clones, activates, and records ancestry", () => {
    const ctx = createMemoryContext("agent");
    const data = ok<{ scenarioId: string; changeId: string }>(
      executeCommand(ctx, "create_scenario", { name: "Agent plan" }),
    );
    expect(data.changeId).toBe("CHG-1");
    expect(ctx.state.scenarios).toHaveLength(2);
    expect(ctx.state.activeScenarioId).toBe(data.scenarioId);
    const branch = ctx.state.scenarios[1];
    expect(branch.parentId).toBe(BASELINE_SCENARIO_ID);
    expect(branch.workItems).toHaveLength(12);
  });

  it("branches are independent of the baseline", () => {
    const ctx = createMemoryContext("agent");
    const { scenarioId } = ok<{ scenarioId: string }>(executeCommand(ctx, "create_scenario", { name: "Branch" }));
    ok(executeCommand(ctx, "route_work_item", { scenarioId, workItemId: "veh-05", resourceId: null }));
    const baseline = ctx.state.scenarios.find((s) => s.id === BASELINE_SCENARIO_ID)!;
    expect(baseline.workItems.find((w) => w.id === "veh-05")!.route.resourceId).toBe("bay-3");
  });

  it("update_resource applies a validated patch and returns before/after", () => {
    const ctx = createMemoryContext("human");
    ok(executeCommand(ctx, "run_simulation", {}));
    const data = ok<MutationReceipt>(
      executeCommand(ctx, "update_resource", {
        resourceId: "bay-3",
        changes: { status: "idle" },
      }),
    );
    expect(data.before).toEqual({ status: "blocked" });
    expect(data.after).toEqual({ status: "idle" });
    expect(data.simulationInvalidated).toBe(true);
    expect(ctx.state.simulations[BASELINE_SCENARIO_ID]).toBeUndefined();
    const bay = ctx.state.scenarios[0].resources.find((r) => r.id === "bay-3")!;
    expect(bay.blockedUntilMinute).toBeNull();
  });

  it("update_resource rejects out-of-range values", () => {
    const error = fail(
      executeCommand(createMemoryContext(), "update_resource", { resourceId: "bay-1", changes: { capacity: 0 } }),
    );
    expect(error).toContain("capacity");
  });

  it("route_work_item rejects a target that cannot run any step", () => {
    const error = fail(
      executeCommand(createMemoryContext(), "route_work_item", { workItemId: "veh-01", resourceId: "diag-1" }),
    );
    expect(error).toContain("station");
  });

  it("route_work_item rejects unknown resources", () => {
    expect(
      fail(executeCommand(createMemoryContext(), "route_work_item", { workItemId: "veh-01", resourceId: "bay-9" })),
    ).toContain("bay-9");
  });

  it("route_work_item pins, positions and reports the previous route", () => {
    const ctx = createMemoryContext();
    const data = ok<MutationReceipt>(
      executeCommand(ctx, "route_work_item", { workItemId: "veh-03", resourceId: "bay-3", position: 1 }),
    );
    expect(data.before).toEqual({ resourceId: null, position: null });
    expect(data.after).toEqual({ resourceId: "bay-3", position: 1 });
    expect(data.summary).toContain("Bay 3, position 1");
  });

  it("run_simulation caches a deterministic result and attributes the run", () => {
    const ctx = createMemoryContext("agent");
    const first = ok(executeCommand(ctx, "run_simulation", {}));
    const second = ok(executeCommand(ctx, "run_simulation", {}));
    expect(JSON.stringify({ ...first, changeId: 0 })).toBe(JSON.stringify({ ...second, changeId: 0 }));
    expect(ctx.state.changes[0]).toMatchObject({ actor: "agent", command: "run_simulation" });
  });

  it("compare_scenarios aligns KPIs and refuses a single scenario", () => {
    const ctx = createMemoryContext("agent");
    const { scenarioId } = ok<{ scenarioId: string }>(executeCommand(ctx, "create_scenario", { name: "Agent plan" }));
    applyBeat(ctx, AGENT_PLAN, scenarioId);
    const data = ok<{ scenarios: { promisesMet: number }[]; deltas: { promisesMet: number }[]; verdict: string }>(
      executeCommand(ctx, "compare_scenarios", { scenarioIds: [BASELINE_SCENARIO_ID, scenarioId] }),
    );
    expect(data.scenarios.map((s) => s.promisesMet)).toEqual([4, 5]);
    expect(data.deltas[0].promisesMet).toBe(1);
    expect(data.verdict).toContain("Agent plan");
    expect(fail(executeCommand(ctx, "compare_scenarios", { scenarioIds: [scenarioId, scenarioId] }))).toContain(
      "different",
    );
  });
});

describe("the demo through the command boundary", () => {
  it("agent plan reaches 5/6, the human decision makes it 6/6", () => {
    const agent = createMemoryContext("agent");
    const { scenarioId } = ok<{ scenarioId: string }>(
      executeCommand(agent, "create_scenario", { name: AGENT_PLAN.scenarioName }),
    );
    applyBeat(agent, AGENT_PLAN, scenarioId);
    const agentRun = ok<{ totals: { promisesMet: number } }>(executeCommand(agent, "run_simulation", { scenarioId }));
    expect(agentRun.totals.promisesMet).toBe(5);

    // The human continues in the same world the agent left behind.
    const human = { ...agent, actor: "human" as const };
    const { scenarioId: finalId } = ok<{ scenarioId: string }>(
      executeCommand(human, "create_scenario", { name: HUMAN_DECISION.scenarioName, fromScenarioId: scenarioId }),
    );
    applyBeat(human, HUMAN_DECISION, finalId);

    // ...and the agent adapts by reading and re-running.
    const finalRun = ok<{ totals: { promisesMet: number; constraintViolations: string[] } }>(
      executeCommand(agent, "run_simulation", { scenarioId: finalId }),
    );
    expect(finalRun.totals.promisesMet).toBe(6);
    expect(finalRun.totals.constraintViolations).toEqual([]);

    const actors = agent.state.changes.map((c) => c.actor);
    expect(actors).toContain("human");
    expect(actors).toContain("agent");
    expect(agent.state.changes[0]).toMatchObject({ actor: "agent", command: "run_simulation" });
  });
});

describe("attribution", () => {
  it("keeps read commands out of the change history", () => {
    const ctx = createMemoryContext();
    const before = ctx.state.changes.length;
    executeCommand(ctx, "inspect_system", {});
    executeCommand(ctx, "inspect_resource", { resourceId: "bay-1" });
    executeCommand(ctx, "inspect_work_item", { workItemId: "veh-01" });
    expect(ctx.state.changes).toHaveLength(before);
  });

  it("uses the injected clock so history is reproducible", () => {
    const ctx = createMemoryContext("human", undefined, () => 1_700_000_000_000);
    executeCommand(ctx, "create_scenario", { name: "Clocked" });
    expect(ctx.state.changes[0].at).toBe(1_700_000_000_000);
  });

  it("activate_scenario is a view change and leaves history alone", () => {
    const ctx = createMemoryContext();
    const { scenarioId } = ok<{ scenarioId: string }>(
      executeCommand(ctx, "create_scenario", { name: "Branch", activate: false }),
    );
    const before = ctx.state.changes.length;
    ok(executeCommand(ctx, "activate_scenario", { scenarioId }));
    expect(ctx.state.activeScenarioId).toBe(scenarioId);
    expect(ctx.state.changes).toHaveLength(before);
  });
});

describe("inject_event", () => {
  it("turns the calm shop into the escalated baseline", () => {
    const ctx = createMemoryContext("human", createInitialState({ story: "calm" }));
    ok(executeCommand(ctx, "inject_event", { disruption: PART_DELAY }));
    const escalated = ctx.state.scenarios[0];
    // Same world the demo baseline hands out, reached by playing the story.
    expect({ ...escalated, description: "" }).toEqual({ ...workshopFixture(), description: "" });
    expect(simulate(escalated).totals.promisesMet).toBe(4);
  });

  it("records the disruption, attributes it, and drops the stale run", () => {
    const ctx = createMemoryContext("simulation", createInitialState({ story: "calm" }));
    ok(executeCommand(ctx, "run_simulation", {}));
    expect(ctx.state.simulations[BASELINE_SCENARIO_ID]).toBeDefined();

    const data = ok<MutationReceipt>(executeCommand(ctx, "inject_event", { disruption: PART_DELAY }));
    expect(data.simulationInvalidated).toBe(true);
    expect(ctx.state.simulations[BASELINE_SCENARIO_ID]).toBeUndefined();
    expect(ctx.state.disruptions[BASELINE_SCENARIO_ID]).toEqual([PART_DELAY]);
    expect(data.before).toEqual({ status: "idle", blockedUntilMinute: null, blockingReason: null });
    expect(data.after).toMatchObject({ status: "blocked", blockedUntilMinute: 15 * 60 + 30 });
    expect(data.summary).toContain("Part delay on Bay 3");
    expect(data.summary).toContain("15:30");
    expect(ctx.state.changes[0]).toMatchObject({ actor: "simulation", command: "inject_event" });
  });

  it("is a demo control the agent cannot fire", () => {
    const ctx = createMemoryContext("agent", createInitialState({ story: "calm" }));
    expect(fail(executeCommand(ctx, "inject_event", { disruption: PART_DELAY }))).toContain(
      "demo control",
    );
    expect(ctx.state.scenarios[0].resources.find((r) => r.id === "bay-3")!.status).toBe("idle");
  });

  it("refuses a disruption aimed at something that is not there", () => {
    const ctx = createMemoryContext("human", createInitialState({ story: "calm" }));
    const error = fail(
      executeCommand(ctx, "inject_event", { disruption: { ...PART_DELAY, resourceId: "bay-9" } }),
    );
    expect(error).toContain("bay-9");
    expect(error).toContain("bay-1");
  });
});

describe("explore_schedules", () => {
  it("returns the same ranking for the same seed", () => {
    const first = ok<ExplorationSummary>(
      executeCommand(createMemoryContext("agent"), "explore_schedules", { seed: 7, replications: 6 }),
    );
    const second = ok<ExplorationSummary>(
      executeCommand(createMemoryContext("agent"), "explore_schedules", { seed: 7, replications: 6 }),
    );
    expect(JSON.stringify({ ...first, changeId: 0 })).toBe(JSON.stringify({ ...second, changeId: 0 }));
  });

  it("finds a plan that keeps all six promises", () => {
    const data = ok<ExplorationSummary>(
      executeCommand(createMemoryContext("agent"), "explore_schedules", {}),
    );
    expect(data.best!.promisesMet).toBe(6);
    expect(data.best!.promisedTotal).toBe(6);
    expect(data.runsExecuted).toBe(data.candidatesEvaluated * data.replications);
  });

  it("returns a shortlist, not the whole search", () => {
    const data = ok<ExplorationSummary & { trace?: unknown[] }>(
      executeCommand(createMemoryContext("agent"), "explore_schedules", { replications: 4 }),
    );
    expect(data.top.length).toBeLessThanOrEqual(8);
    expect(data.candidatesEvaluated).toBeGreaterThan(data.top.length);
    // The command always carries the animation trace for the page; everything
    // else stays a bounded shortlist. The WebMCP layer strips the trace from
    // agent responses (covered in src/webmcp/adapter.test.ts).
    expect(Array.isArray(data.trace)).toBe(true);
    const bounded = { ...data };
    delete bounded.trace;
    expect(JSON.stringify(bounded).length).toBeLessThan(20_000);
  });

  it("records one attributed change quoting the measured result", () => {
    const ctx = createMemoryContext("agent");
    const before = ctx.state.changes.length;
    const data = ok<ExplorationSummary>(executeCommand(ctx, "explore_schedules", { replications: 4 }));
    expect(ctx.state.changes).toHaveLength(before + 1);
    const change = ctx.state.changes[0];
    expect(change).toMatchObject({ actor: "agent", command: "explore_schedules" });
    expect(change.summary).toContain(`Explored ${data.candidatesEvaluated} schedules`);
    expect(change.summary).toContain(
      `best ${data.best!.promisesMet}/${data.best!.promisedTotal}`,
    );
    // The headline quotes the measured rate; no number is hardcoded anywhere.
    expect(change.summary).toContain(
      `${Math.round(data.best!.promisesMetRate * 100)} % of runs`,
    );
  });

  it("leaves the world exactly as it found it", () => {
    const ctx = createMemoryContext("agent");
    const before = JSON.stringify(ctx.state.scenarios);
    ok(executeCommand(ctx, "explore_schedules", { replications: 4 }));
    expect(JSON.stringify(ctx.state.scenarios)).toBe(before);
  });
});

describe("apply_plan", () => {
  it("applies a whole plan as one attributed change and reaches 6/6", () => {
    const ctx = createMemoryContext("human");
    const agentPlan = planFromBeat(AGENT_PLAN);
    const before = ctx.state.changes.length;
    const receipt = ok<MutationReceipt & { changesApplied: number; workItemsTouched: string[] }>(
      executeCommand(ctx, "apply_plan", { plan: agentPlan }),
    );
    expect(receipt.changesApplied).toBe(agentPlan.changes.length);
    expect(receipt.workItemsTouched).toContain("veh-05");
    expect(ctx.state.changes).toHaveLength(before + 1);
    expect(receipt.summary).toContain("Agent plan");
    expect(receipt.summary).toContain("6 priority changes");
    expect(simulate(ctx.state.scenarios[0]).totals.promisesMet).toBe(5);

    ok(executeCommand(ctx, "apply_plan", { plan: planFromBeat(HUMAN_DECISION) }));
    expect(simulate(ctx.state.scenarios[0]).totals.promisesMet).toBe(6);
    expect(ctx.state.changes).toHaveLength(before + 2);
  });

  it("carries a before/after for every work item it touched", () => {
    const ctx = createMemoryContext("human");
    const receipt = ok<MutationReceipt>(
      executeCommand(ctx, "apply_plan", { plan: planFromBeat(HUMAN_DECISION) }),
    );
    // Both halves of the manager's decision, each with its own before/after.
    expect(receipt.before).toEqual({
      "veh-03": { priority: 3, route: { resourceId: null, position: null } },
      "veh-12": { priority: 1, route: { resourceId: "bay-3", position: 1 } },
    });
    expect(receipt.after).toEqual({
      "veh-03": { priority: 3, route: { resourceId: "bay-3", position: 1 } },
      "veh-12": { priority: 1, route: { resourceId: null, position: null } },
    });
  });

  it("protects the baseline from the agent and branches cleanly", () => {
    const ctx = createMemoryContext("agent");
    expect(fail(executeCommand(ctx, "apply_plan", { plan: planFromBeat(AGENT_PLAN) }))).toContain(
      "create_scenario",
    );
    const { scenarioId } = ok<{ scenarioId: string }>(
      executeCommand(ctx, "create_scenario", { name: "Agent plan" }),
    );
    ok(executeCommand(ctx, "apply_plan", { plan: planFromBeat(AGENT_PLAN), scenarioId }));
    const baseline = ctx.state.scenarios.find((s) => s.id === BASELINE_SCENARIO_ID)!;
    expect(baseline.workItems.find((w) => w.id === "veh-05")!.route.resourceId).toBe("bay-3");
    expect(ctx.state.changes[0]).toMatchObject({ actor: "agent", command: "apply_plan" });
  });

  it("applies the same validation the individual commands do", () => {
    const ctx = createMemoryContext("human");
    const error = fail(
      executeCommand(ctx, "apply_plan", {
        plan: {
          id: "PLAN-BAD",
          label: "Impossible",
          changes: [
            { command: "route_work_item", workItemId: "veh-01", resourceId: "diag-1", position: null },
          ],
        },
      }),
    );
    expect(error).toContain("station");
    // Nothing partially applied: the plan is one change or none.
    expect(ctx.state.scenarios[0].workItems[0].route.resourceId).toBeNull();
  });

  it("rejects an empty plan and unknown work items", () => {
    const ctx = createMemoryContext("human");
    expect(fail(executeCommand(ctx, "apply_plan", { plan: { id: "P", label: "Empty", changes: [] } }))).toContain(
      "Invalid input",
    );
    expect(
      fail(
        executeCommand(ctx, "apply_plan", {
          plan: {
            id: "P",
            label: "Ghost",
            changes: [{ command: "update_work_item", workItemId: "veh-99", priority: 1 }],
          },
        }),
      ),
    ).toContain("veh-99");
  });

  it("carries the plan the exploration recommended, end to end", () => {
    const ctx = createMemoryContext("agent");
    const { scenarioId } = ok<{ scenarioId: string }>(
      executeCommand(ctx, "create_scenario", { name: "Explored" }),
    );
    const summary = ok<ExplorationSummary>(executeCommand(ctx, "explore_schedules", { scenarioId }));
    const best = summary.best!;
    ok(
      executeCommand(ctx, "apply_plan", {
        scenarioId,
        plan: { id: `PLAN-${best.id}`, label: best.label, changes: best.changes },
      }),
    );
    const branch = ctx.state.scenarios.find((s) => s.id === scenarioId)!;
    // The searched number and the applied number are the same number.
    expect(simulate(branch).totals.promisesMet).toBe(best.promisesMet);
    expect(simulate(branch).totals.promisesMet).toBe(6);
  });
});

describe("post_shift_note", () => {
  it("stores the note with its channels and attributes the author", () => {
    const ctx = createMemoryContext("agent", undefined, () => 1_700_000_000_000);
    const data = ok<{ note: ShiftNote; delivered: boolean }>(
      executeCommand(ctx, "post_shift_note", {
        text: "Bay 3 reopens 15:30. White SUV goes in first; the wagon moves to Bay 2. All six promises hold.",
        channels: ["slack", "email"],
        recipients: ["floor-team"],
      }),
    );
    expect(ctx.state.notes).toHaveLength(1);
    expect(ctx.state.notes[0]).toEqual(data.note);
    expect(data.note.channels).toEqual(["slack", "email"]);
    expect(data.note.recipients).toEqual(["floor-team"]);
    expect(data.note.author).toBe("agent");
    expect(data.note.at).toBe(1_700_000_000_000);
    expect(data.note.scenarioId).toBe(BASELINE_SCENARIO_ID);
  });

  it("keeps notes newest first, the way the resolved card reads them", () => {
    const ctx = createMemoryContext("human");
    ok(executeCommand(ctx, "post_shift_note", { text: "First note.", channels: ["slack"] }));
    const second = ok<{ note: ShiftNote }>(
      executeCommand(ctx, "post_shift_note", { text: "Second note.", channels: ["slack"] }),
    );
    expect(ctx.state.notes).toHaveLength(2);
    expect(ctx.state.notes[0]).toEqual(second.note);
    expect(ctx.state.notes[0].text).toBe("Second note.");
    expect(ctx.state.notes[1].text).toBe("First note.");
  });

  it("performs no delivery: the note only lands in the shop log", () => {
    const ctx = createMemoryContext("human");
    const data = ok<{ delivered: boolean; summary: string }>(
      executeCommand(ctx, "post_shift_note", { text: "Shift note.", channels: ["sms"] }),
    );
    expect(data.delivered).toBe(false);
    expect(data.summary).toContain("recorded in the shop log");
    // The agent-visible surface stays in-world: no demo vocabulary anywhere.
    expect(JSON.stringify(data)).not.toMatch(/simulated|demo/i);
    expect(ctx.state.changes[0]).toMatchObject({ actor: "human", command: "post_shift_note" });
  });

  it("de-duplicates channels and refuses a note with none", () => {
    const ctx = createMemoryContext("human");
    const data = ok<{ note: ShiftNote }>(
      executeCommand(ctx, "post_shift_note", { text: "Note.", channels: ["slack", "slack"] }),
    );
    expect(data.note.channels).toEqual(["slack"]);
    expect(fail(executeCommand(ctx, "post_shift_note", { text: "Note.", channels: [] }))).toContain(
      "Invalid input",
    );
    expect(
      fail(executeCommand(ctx, "post_shift_note", { text: "Note.", channels: ["carrier-pigeon"] })),
    ).toContain("Invalid input");
  });

  it("keeps the world out of it — a note changes no schedule", () => {
    const ctx = createMemoryContext("human");
    const before = JSON.stringify(ctx.state.scenarios);
    ok(executeCommand(ctx, "post_shift_note", { text: "Note.", channels: ["slack"] }));
    expect(JSON.stringify(ctx.state.scenarios)).toBe(before);
  });
});

describe("the whole story through the command boundary", () => {
  it("calm → escalation → exploration → plan → note, every step attributed", () => {
    const ctx = createMemoryContext("human", createInitialState({ story: "calm" }));
    expect(simulate(ctx.state.scenarios[0]).totals.promisesMet).toBe(6);

    // Beat 2: the part delay lands (simulation drives it).
    const sim = { ...ctx, actor: "simulation" as const };
    ok(executeCommand(sim, "inject_event", { disruption: PART_DELAY }));
    expect(simulate(ctx.state.scenarios[0]).totals.promisesMet).toBe(4);

    // Beat 3: the agent branches and searches.
    const agent = { ...ctx, actor: "agent" as const };
    const { scenarioId } = ok<{ scenarioId: string }>(
      executeCommand(agent, "create_scenario", { name: "Recovery" }),
    );
    const summary = ok<ExplorationSummary>(executeCommand(agent, "explore_schedules", { scenarioId }));

    // Beats 4-5: the agent applies the winning plan and tells the team.
    ok(
      executeCommand(agent, "apply_plan", {
        scenarioId,
        plan: {
          id: "PLAN-RECOVERY",
          label: summary.best!.label,
          changes: summary.best!.changes,
        },
      }),
    );
    const run = ok<{ totals: { promisesMet: number } }>(
      executeCommand(agent, "run_simulation", { scenarioId }),
    );
    expect(run.totals.promisesMet).toBe(6);
    ok(
      executeCommand(agent, "post_shift_note", {
        scenarioId,
        text: `Recovery applied: ${summary.best!.label}. All six promises hold.`,
        channels: ["slack", "email"],
      }),
    );

    const commands = ctx.state.changes.map((c) => `${c.actor}:${c.command}`);
    expect(commands).toContain("simulation:inject_event");
    expect(commands).toContain("agent:explore_schedules");
    expect(commands).toContain("agent:apply_plan");
    expect(commands).toContain("agent:post_shift_note");
    // The baseline the human still looks at was never touched by the agent.
    expect(simulate(ctx.state.scenarios[0]).totals.promisesMet).toBe(4);
  });
});
