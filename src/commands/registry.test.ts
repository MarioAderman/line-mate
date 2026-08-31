import { describe, expect, it } from "vitest";
import { AGENT_PLAN, BASELINE_SCENARIO_ID, HUMAN_DECISION, type DemoBeat } from "@/domain";
import { createMemoryContext, type CommandContext } from "./state";
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
  "run_simulation",
];

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
  it("exposes the v0.1 tool set plus the human-only view switch", () => {
    expect([...COMMAND_NAMES].sort()).toEqual(
      [...AGENT_TOOLS, "activate_scenario", "reset_demo"].sort(),
    );
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
