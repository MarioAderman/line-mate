/**
 * The command registry: the only mutation/read API in the app.
 *
 * Human UI and WebMCP agent both call `executeCommand`. Nothing else may
 * reach into scenario state — which is what makes the activity strip
 * trustworthy, since every state transition mints a `Change` carrying its
 * actor, and what keeps the baseline safe from an over-eager agent.
 */
import { z } from "zod";
import {
  BASELINE_SCENARIO_ID,
  ResourceSchema,
  ScenarioSchema,
  findResource,
  findTechnician,
  findWorkItem,
  formatMinute,
  skilledTechnicians,
  validateScenario,
  type Actor,
  type Change,
  type Scenario,
  type WorkItem,
} from "@/domain";
import { compareScenarios, simulate, type SimulationResult } from "@/simulation";
import { createInitialState } from "./state";
import type { CommandContext, WorkshopState } from "./state";

export class CommandError extends Error {}

export type CommandKind = "read" | "mutation" | "action";

export interface CommandDefinition<Input = unknown, Output = unknown> {
  name: string;
  kind: CommandKind;
  title: string;
  description: string;
  input: z.ZodType<Input>;
  run(ctx: CommandContext, input: Input): Output;
}

export type CommandResult<T = unknown> =
  | { ok: true; command: string; actor: Actor; data: T }
  | { ok: false; command: string; actor: Actor; error: string };

/** What every mutation returns, so callers can show attribution immediately. */
export interface MutationReceipt {
  changeId: string;
  actor: Actor;
  scenarioId: string;
  summary: string;
  before: unknown;
  after: unknown;
  simulationInvalidated: boolean;
}

const TIMELINE_LIMIT = 200;

/* ------------------------------------------------------------------ utils */

function resolveScenario(state: WorkshopState, scenarioId?: string): Scenario {
  const id = scenarioId ?? state.activeScenarioId;
  const scenario = state.scenarios.find((s) => s.id === id);
  if (!scenario) {
    throw new CommandError(
      `Unknown scenario "${id}". Known: ${state.scenarios.map((s) => s.id).join(", ")}.`,
    );
  }
  return scenario;
}

function isBaseline(scenario: Scenario): boolean {
  return scenario.id === BASELINE_SCENARIO_ID;
}

/**
 * Baseline protection: the agent must branch before editing the baseline
 * unless the human explicitly allowed an in-place change.
 */
function assertMutable(ctx: CommandContext, scenario: Scenario, allow?: boolean): void {
  if (ctx.actor === "agent" && isBaseline(scenario) && !allow) {
    throw new CommandError(
      `"${scenario.name}" is the protected baseline. Call create_scenario first, ` +
        `or pass allowBaselineEdit: true if the user asked for an in-place change.`,
    );
  }
}

function assertScenarioValid(scenario: Scenario): void {
  const problems = validateScenario(scenario);
  if (problems.length > 0) throw new CommandError(problems.join(" "));
}

interface ChangeInput {
  command: string;
  scenarioId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

/** Appends a `Change`, advances the id sequence, and returns its id. */
function withChange(
  state: WorkshopState,
  ctx: CommandContext,
  input: ChangeInput,
): { state: WorkshopState; changeId: string } {
  const changeId = `CHG-${state.sequence}`;
  const change: Change = {
    id: changeId,
    at: ctx.now(),
    actor: ctx.actor,
    command: input.command,
    scenarioId: input.scenarioId,
    summary: input.summary,
    before: input.before ?? null,
    after: input.after ?? null,
  };
  return {
    changeId,
    state: {
      ...state,
      sequence: state.sequence + 1,
      changes: [change, ...state.changes].slice(0, 200),
    },
  };
}

/** Replaces a scenario and drops its stale simulation cache entry. */
function withScenario(state: WorkshopState, scenario: Scenario): WorkshopState {
  const simulations = { ...state.simulations };
  delete simulations[scenario.id];
  return {
    ...state,
    simulations,
    scenarios: state.scenarios.map((s) => (s.id === scenario.id ? scenario : s)),
  };
}

/** Commits a validated scenario edit and returns the mutation receipt. */
function commit(
  ctx: CommandContext,
  next: Scenario,
  input: ChangeInput,
): MutationReceipt {
  assertScenarioValid(next);
  let changeId = "";
  ctx.setState((s) => {
    const result = withChange(withScenario(s, next), ctx, input);
    changeId = result.changeId;
    return result.state;
  });
  return {
    changeId,
    actor: ctx.actor,
    scenarioId: next.id,
    summary: input.summary,
    before: input.before ?? null,
    after: input.after ?? null,
    simulationInvalidated: true,
  };
}

function describeRoute(item: WorkItem, scenario: Scenario): string {
  if (item.route.resourceId === null) return "any eligible bay";
  const name = findResource(scenario, item.route.resourceId)?.name ?? item.route.resourceId;
  return item.route.position === null ? name : `${name}, position ${item.route.position}`;
}

function boundedResult(result: SimulationResult, includeTimeline: boolean) {
  const { timeline, segments, ...rest } = result;
  return {
    ...rest,
    segments: segments.length,
    timeline: includeTimeline
      ? timeline.slice(0, TIMELINE_LIMIT)
      : {
          events: timeline.length,
          firstMinute: timeline[0]?.minute ?? null,
          lastMinute: timeline[timeline.length - 1]?.minute ?? null,
          note: "Pass includeTimeline: true for the event list (max 200 events).",
        },
  };
}

function scenarioSummary(state: WorkshopState, scenario: Scenario) {
  const sim = state.simulations[scenario.id];
  return {
    id: scenario.id,
    name: scenario.name,
    parentId: scenario.parentId,
    isBaseline: isBaseline(scenario),
    isActive: scenario.id === state.activeScenarioId,
    simulated: Boolean(sim),
    promisesMet: sim ? sim.totals.promisesMet : null,
    promisedTotal: scenario.workItems.filter((w) => w.dueMinute !== null).length,
  };
}

/* --------------------------------------------------------------- schemas */

const scenarioRef = z.string().min(1).optional();
const allowBaseline = z.boolean().optional();

/* --------------------------------------------------------------- reads */

const inspectSystem: CommandDefinition = {
  name: "inspect_system",
  kind: "read",
  title: "Inspect system",
  description:
    "Overview of the active scenario: shift clock, constraints, bays and " +
    "technicians, waiting jobs with their promises, the latest simulation " +
    "KPIs, and recent human/agent changes. Use this first.",
  input: z.object({ scenarioId: scenarioRef }),
  run: (ctx, raw) => {
    const { scenarioId } = raw as { scenarioId?: string };
    const state = ctx.getState();
    const scenario = resolveScenario(state, scenarioId);
    const sim = state.simulations[scenario.id];
    return {
      scenario: {
        ...scenarioSummary(state, scenario),
        description: scenario.description,
        clock: {
          day: scenario.clock.dayLabel,
          now: formatMinute(scenario.clock.startMinute),
          closes: formatMinute(scenario.clock.endMinute),
          minutesLeft: scenario.clock.endMinute - scenario.clock.startMinute,
        },
        constraints: scenario.constraints,
      },
      scenarios: state.scenarios.map((s) => scenarioSummary(state, s)),
      resources: scenario.resources.map((r) => {
        const stat = sim?.resources.find((x) => x.resourceId === r.id);
        return {
          id: r.id,
          name: r.name,
          type: r.type,
          status: r.status,
          blockedUntil: r.blockedUntilMinute === null ? null : formatMinute(r.blockedUntilMinute),
          blockingReason: r.blockingReason,
          queued: scenario.workItems.filter((w) => w.route.resourceId === r.id).map((w) => w.id),
          utilization: stat?.utilization ?? null,
        };
      }),
      technicians: scenario.technicians.map((t) => {
        const stat = sim?.technicians.find((x) => x.technicianId === t.id);
        return { id: t.id, name: t.name, skills: t.skills, utilization: stat?.utilization ?? null };
      }),
      workItems: scenario.workItems.map((w) => {
        const outcome = sim?.workItems.find((x) => x.workItemId === w.id);
        return {
          id: w.id,
          name: w.name,
          vehicle: w.vehicle,
          priority: w.priority,
          status: w.status,
          promisedBy: w.dueMinute === null ? null : formatMinute(w.dueMinute),
          workMinutes: w.steps.reduce((s, step) => s + step.durationMinutes, 0),
          route: describeRoute(w, scenario),
          onTime: outcome?.onTime ?? null,
        };
      }),
      kpis: sim ? sim.totals : null,
      simulationStale: !sim,
      recentChanges: state.changes.slice(0, 5).map((c) => ({
        id: c.id,
        actor: c.actor,
        command: c.command,
        scenarioId: c.scenarioId,
        summary: c.summary,
      })),
    };
  },
};

const inspectResource: CommandDefinition = {
  name: "inspect_resource",
  kind: "read",
  title: "Inspect resource",
  description:
    "Detail for one bay or station: status and blocking reason, the jobs " +
    "routed to it, its utilisation and queue from the last run, and which " +
    "technicians can work there.",
  input: z.object({ resourceId: z.string().min(1), scenarioId: scenarioRef }),
  run: (ctx, raw) => {
    const { resourceId, scenarioId } = raw as { resourceId: string; scenarioId?: string };
    const state = ctx.getState();
    const scenario = resolveScenario(state, scenarioId);
    const resource = findResource(scenario, resourceId);
    if (!resource) {
      throw new CommandError(
        `Unknown resource "${resourceId}". Known: ${scenario.resources.map((r) => r.id).join(", ")}.`,
      );
    }
    const sim = state.simulations[scenario.id];
    const stat = sim?.resources.find((r) => r.resourceId === resourceId) ?? null;
    const routed = scenario.workItems
      .filter((w) => w.route.resourceId === resourceId)
      .sort((a, b) => (a.route.position ?? 99) - (b.route.position ?? 99) || a.priority - b.priority);
    return {
      scenarioId: scenario.id,
      resource: {
        ...resource,
        blockedUntil: resource.blockedUntilMinute === null ? null : formatMinute(resource.blockedUntilMinute),
      },
      routedWorkItems: routed.map((w) => ({
        id: w.id,
        name: w.name,
        vehicle: w.vehicle,
        priority: w.priority,
        position: w.route.position,
        promisedBy: w.dueMinute === null ? null : formatMinute(w.dueMinute),
      })),
      statistics: stat,
      schedule: sim
        ? sim.segments
            .filter((s) => s.resourceId === resourceId)
            .map((s) => ({
              workItemId: s.workItemId,
              technicianId: s.technicianId,
              operation: s.operation,
              start: formatMinute(s.start),
              end: formatMinute(s.end),
            }))
        : null,
      isBottleneck: sim?.totals.bottleneck?.id === resourceId,
    };
  },
};

const inspectWorkItem: CommandDefinition = {
  name: "inspect_work_item",
  kind: "read",
  title: "Inspect work item",
  description:
    "Detail for one vehicle's job: promise, priority, steps with the skill " +
    "each needs and who has it, current route, and a feasibility signal " +
    "(work remaining versus time to the promise). Includes last-run timings.",
  input: z.object({ workItemId: z.string().min(1), scenarioId: scenarioRef }),
  run: (ctx, raw) => {
    const { workItemId, scenarioId } = raw as { workItemId: string; scenarioId?: string };
    const state = ctx.getState();
    const scenario = resolveScenario(state, scenarioId);
    const item = findWorkItem(scenario, workItemId);
    if (!item) {
      throw new CommandError(
        `Unknown work item "${workItemId}". Known: ${scenario.workItems.map((w) => w.id).join(", ")}.`,
      );
    }
    const sim = state.simulations[scenario.id];
    const outcome = sim?.workItems.find((w) => w.workItemId === workItemId) ?? null;
    const workMinutes = item.steps.reduce((s, step) => s + step.durationMinutes, 0);
    const minutesToPromise =
      item.dueMinute === null ? null : item.dueMinute - scenario.clock.startMinute;
    return {
      scenarioId: scenario.id,
      workItem: {
        ...item,
        arrivedAt: formatMinute(item.arrivalMinute),
        promisedBy: item.dueMinute === null ? null : formatMinute(item.dueMinute),
        route: describeRoute(item, scenario),
        routeRaw: item.route,
      },
      steps: item.steps.map((step, index) => {
        const segment = sim?.segments.find((s) => s.workItemId === workItemId && s.stepIndex === index);
        return {
          index,
          operation: step.operation,
          durationMinutes: step.durationMinutes,
          needs: `${step.requiredResourceType} + ${step.requiredSkill}`,
          technicians: skilledTechnicians(scenario, step.requiredSkill).map((t) => t.name),
          start: segment ? formatMinute(segment.start) : null,
          end: segment ? formatMinute(segment.end) : null,
          resourceId: segment?.resourceId ?? null,
          technicianId: segment?.technicianId ?? null,
        };
      }),
      feasibility: {
        workMinutes,
        minutesToPromise,
        slackMinutes: minutesToPromise === null ? null : minutesToPromise - workMinutes,
        blockedRoute:
          item.route.resourceId !== null &&
          (findResource(scenario, item.route.resourceId)?.status === "blocked" ||
            findResource(scenario, item.route.resourceId)?.status === "down"),
      },
      outcome,
    };
  },
};

const getSimulationResults: CommandDefinition = {
  name: "get_simulation_results",
  kind: "read",
  title: "Get simulation results",
  description:
    "Structured results of the last run for one scenario: promises met, " +
    "completions, revenue and cost, utilisation, late and unfinished jobs, " +
    "bottleneck. Fails if the scenario has not been simulated yet.",
  input: z.object({ scenarioId: scenarioRef, includeTimeline: z.boolean().optional() }),
  run: (ctx, raw) => {
    const { scenarioId, includeTimeline } = raw as { scenarioId?: string; includeTimeline?: boolean };
    const state = ctx.getState();
    const scenario = resolveScenario(state, scenarioId);
    const result = state.simulations[scenario.id];
    if (!result) {
      throw new CommandError(
        `"${scenario.name}" has not been simulated yet. Call run_simulation first.`,
      );
    }
    return boundedResult(result, includeTimeline ?? false);
  },
};

const compareScenariosCommand: CommandDefinition = {
  name: "compare_scenarios",
  kind: "read",
  title: "Compare scenarios",
  description:
    "Aligned KPIs for two to four scenarios (promises, completions, revenue, " +
    "labor cost, wait, lead time, constraint violations) with deltas against " +
    "the first one and a one-line verdict. Simulates on the fly if needed.",
  input: z.object({ scenarioIds: z.array(z.string().min(1)).min(2).max(4) }),
  run: (ctx, raw) => {
    const { scenarioIds } = raw as { scenarioIds: string[] };
    const state = ctx.getState();
    const unique = [...new Set(scenarioIds)];
    if (unique.length < 2) throw new CommandError("Pick at least two different scenarios.");
    const scenarios = unique.map((id) => resolveScenario(state, id));
    const [base, ...others] = scenarios;
    const results = scenarios.map((s) => state.simulations[s.id] ?? simulate(s));
    const comparisons = others.map((candidate) => compareScenarios(base, candidate));
    return {
      scenarios: scenarios.map((s, i) => ({
        id: s.id,
        name: s.name,
        promisesMet: results[i].totals.promisesMet,
        promisedTotal: results[i].totals.promisedTotal,
        completed: results[i].totals.completed,
        revenueUsd: results[i].totals.revenueUsd,
        laborCostUsd: results[i].totals.laborCostUsd,
        avgWaitMinutes: results[i].totals.avgWaitMinutes,
        avgLeadTimeMinutes: results[i].totals.avgLeadTimeMinutes,
        lateWorkItems: results[i].totals.lateWorkItems,
        constraintViolations: results[i].totals.constraintViolations,
      })),
      deltas: comparisons.map((c, i) => ({ scenarioId: others[i].id, ...c.deltas })),
      verdict: comparisons.map((c) => c.verdict).join(" "),
    };
  },
};

/* ------------------------------------------------------------ mutations */

const createScenario: CommandDefinition = {
  name: "create_scenario",
  kind: "mutation",
  title: "Create scenario",
  description:
    "Clone a scenario into a named experiment and make it active. Do this " +
    "before changing anything so the baseline stays intact for comparison.",
  input: z.object({
    name: z.string().min(1).max(60),
    description: z.string().max(280).optional(),
    fromScenarioId: scenarioRef,
    activate: z.boolean().optional(),
  }),
  run: (ctx, raw) => {
    const input = raw as { name: string; description?: string; fromScenarioId?: string; activate?: boolean };
    const state = ctx.getState();
    const source = resolveScenario(state, input.fromScenarioId);
    const id = `SCN-${String(state.sequence).padStart(3, "0")}`;
    const scenario = ScenarioSchema.parse({
      ...structuredClone(source),
      id,
      name: input.name,
      description: input.description ?? `Branched from ${source.name}.`,
      parentId: source.id,
      createdAt: new Date(ctx.now()).toISOString(),
    });
    const activate = input.activate ?? true;
    let changeId = "";
    ctx.setState((s) => {
      const result = withChange(
        {
          ...s,
          scenarios: [...s.scenarios, scenario],
          activeScenarioId: activate ? scenario.id : s.activeScenarioId,
        },
        ctx,
        {
          command: "create_scenario",
          scenarioId: scenario.id,
          summary: `Created scenario "${scenario.name}" from "${source.name}".`,
          before: { fromScenarioId: source.id },
          after: { scenarioId: scenario.id },
        },
      );
      changeId = result.changeId;
      return result.state;
    });
    return {
      changeId,
      actor: ctx.actor,
      scenarioId: scenario.id,
      name: scenario.name,
      activated: activate,
      summary: `Created scenario "${scenario.name}" from "${source.name}".`,
    };
  },
};

const resourcePatch = ResourceSchema.pick({
  name: true,
  capacity: true,
  availability: true,
  costPerHour: true,
  status: true,
  blockedUntilMinute: true,
  blockingReason: true,
}).partial();

const updateResource: CommandDefinition = {
  name: "update_resource",
  kind: "mutation",
  title: "Update resource",
  description:
    "Validated partial update of a bay or station: status, blocking, " +
    "capacity, availability, cost, name. Cannot add resources or technicians.",
  input: z.object({
    resourceId: z.string().min(1),
    scenarioId: scenarioRef,
    allowBaselineEdit: allowBaseline,
    changes: resourcePatch.refine((p) => Object.keys(p).length > 0, {
      message: "changes must include at least one field",
    }),
  }),
  run: (ctx, raw) => {
    const input = raw as {
      resourceId: string;
      scenarioId?: string;
      allowBaselineEdit?: boolean;
      changes: Partial<z.infer<typeof resourcePatch>>;
    };
    const state = ctx.getState();
    const scenario = resolveScenario(state, input.scenarioId);
    assertMutable(ctx, scenario, input.allowBaselineEdit);
    const current = findResource(scenario, input.resourceId);
    if (!current) throw new CommandError(`Unknown resource "${input.resourceId}".`);

    const updated = ResourceSchema.parse({ ...current, ...input.changes });
    if (updated.status !== "blocked" && updated.status !== "down" && input.changes.status) {
      updated.blockedUntilMinute = null;
      updated.blockingReason = null;
    }
    const fields = Object.keys(input.changes) as (keyof typeof input.changes)[];
    const before = Object.fromEntries(fields.map((f) => [f, current[f]]));
    const after = Object.fromEntries(fields.map((f) => [f, updated[f]]));
    const next: Scenario = {
      ...scenario,
      resources: scenario.resources.map((r) => (r.id === updated.id ? updated : r)),
    };
    return {
      ...commit(ctx, next, {
        command: "update_resource",
        scenarioId: next.id,
        summary: `${updated.name}: ${fields.map((f) => `${f} ${String(current[f])} → ${String(updated[f])}`).join(", ")}.`,
        before,
        after,
      }),
      resource: updated,
    };
  },
};

const updateWorkItem: CommandDefinition = {
  name: "update_work_item",
  kind: "mutation",
  title: "Update work item",
  description:
    "Change a job's priority (1 = first). Promises, steps and revenue are " +
    "facts about the customer and cannot be edited; cancelling is not allowed.",
  input: z.object({
    workItemId: z.string().min(1),
    scenarioId: scenarioRef,
    allowBaselineEdit: allowBaseline,
    changes: z.object({ priority: z.number().int().min(1).max(5) }),
  }),
  run: (ctx, raw) => {
    const input = raw as {
      workItemId: string;
      scenarioId?: string;
      allowBaselineEdit?: boolean;
      changes: { priority: number };
    };
    const state = ctx.getState();
    const scenario = resolveScenario(state, input.scenarioId);
    assertMutable(ctx, scenario, input.allowBaselineEdit);
    const item = findWorkItem(scenario, input.workItemId);
    if (!item) throw new CommandError(`Unknown work item "${input.workItemId}".`);
    const updated: WorkItem = { ...item, priority: input.changes.priority };
    const next: Scenario = {
      ...scenario,
      workItems: scenario.workItems.map((w) => (w.id === item.id ? updated : w)),
    };
    return {
      ...commit(ctx, next, {
        command: "update_work_item",
        scenarioId: next.id,
        summary: `${item.vehicle} (${item.name}): priority ${item.priority} → ${updated.priority}.`,
        before: { priority: item.priority },
        after: { priority: updated.priority },
      }),
      workItem: updated,
    };
  },
};

const routeWorkItem: CommandDefinition = {
  name: "route_work_item",
  kind: "mutation",
  title: "Route work item",
  description:
    "Send a job to a specific bay or station, optionally at a queue position " +
    "(1 = next). resourceId null clears the pin so the job takes any eligible " +
    "bay. The target must be able to run at least one of the job's steps.",
  input: z.object({
    workItemId: z.string().min(1),
    resourceId: z.string().min(1).nullable(),
    position: z.number().int().min(1).max(20).nullable().optional(),
    scenarioId: scenarioRef,
    allowBaselineEdit: allowBaseline,
  }),
  run: (ctx, raw) => {
    const input = raw as {
      workItemId: string;
      resourceId: string | null;
      position?: number | null;
      scenarioId?: string;
      allowBaselineEdit?: boolean;
    };
    const state = ctx.getState();
    const scenario = resolveScenario(state, input.scenarioId);
    assertMutable(ctx, scenario, input.allowBaselineEdit);
    const item = findWorkItem(scenario, input.workItemId);
    if (!item) throw new CommandError(`Unknown work item "${input.workItemId}".`);
    if (input.resourceId !== null) {
      const target = findResource(scenario, input.resourceId);
      if (!target) throw new CommandError(`Unknown resource "${input.resourceId}".`);
      if (!item.steps.some((s) => s.requiredResourceType === target.type)) {
        throw new CommandError(
          `${item.vehicle} cannot be routed to ${target.name}: none of its steps run on a ${target.type}.`,
        );
      }
    }
    const updated: WorkItem = {
      ...item,
      route: { resourceId: input.resourceId, position: input.position ?? null },
    };
    const next: Scenario = {
      ...scenario,
      workItems: scenario.workItems.map((w) => (w.id === item.id ? updated : w)),
    };
    return {
      ...commit(ctx, next, {
        command: "route_work_item",
        scenarioId: next.id,
        summary: `${item.vehicle} (${item.name}): ${describeRoute(item, scenario)} → ${describeRoute(updated, scenario)}.`,
        before: item.route,
        after: updated.route,
      }),
      workItem: updated,
    };
  },
};

/* --------------------------------------------------------------- actions */

const runSimulation: CommandDefinition = {
  name: "run_simulation",
  kind: "action",
  title: "Run simulation",
  description:
    "Run the deterministic shift simulation for a scenario and cache the " +
    "result. Same scenario in, same numbers out. Returns bounded results; " +
    "pass includeTimeline: true for the event list.",
  input: z.object({ scenarioId: scenarioRef, includeTimeline: z.boolean().optional() }),
  run: (ctx, raw) => {
    const { scenarioId, includeTimeline } = raw as { scenarioId?: string; includeTimeline?: boolean };
    const state = ctx.getState();
    const scenario = resolveScenario(state, scenarioId);
    const result = simulate(scenario);
    let changeId = "";
    ctx.setState((s) => {
      const r = withChange(
        { ...s, simulations: { ...s.simulations, [scenario.id]: result } },
        ctx,
        {
          command: "run_simulation",
          scenarioId: scenario.id,
          summary:
            `Simulated "${scenario.name}": ${result.totals.promisesMet}/${result.totals.promisedTotal} promises, ` +
            `${result.totals.completed}/${result.totals.total} jobs done by ${formatMinute(scenario.clock.endMinute)}.`,
          before: null,
          after: { promisesMet: result.totals.promisesMet, completed: result.totals.completed },
        },
      );
      changeId = r.changeId;
      return r.state;
    });
    return { changeId, actor: ctx.actor, ...boundedResult(result, includeTimeline ?? false) };
  },
};

/* ------------------------------------------------------- human-only view */

const activateScenario: CommandDefinition = {
  name: "activate_scenario",
  kind: "mutation",
  title: "Activate scenario",
  description:
    "Switch which scenario the floor is showing. A view decision for the " +
    "person at the screen, so it is not exposed as an agent tool.",
  input: z.object({ scenarioId: z.string().min(1) }),
  run: (ctx, raw) => {
    const { scenarioId } = raw as { scenarioId: string };
    const state = ctx.getState();
    const scenario = resolveScenario(state, scenarioId);
    if (state.activeScenarioId === scenario.id) {
      return { scenarioId: scenario.id, changed: false };
    }
    ctx.setState((s) => ({ ...s, activeScenarioId: scenario.id }));
    return { scenarioId: scenario.id, changed: true };
  },
};

const resetDemo: CommandDefinition = {
  name: "reset_demo",
  kind: "mutation",
  title: "Reset demo",
  description:
    "Rebuild the whole world to the fixture — the demo's reset button. A " +
    "human control for recording takes; the agent is never offered it.",
  input: z.object({ story: z.enum(["calm", "escalated"]).optional() }),
  run: (ctx, raw) => {
    const { story } = raw as { story?: "calm" | "escalated" };
    if (ctx.actor === "agent") {
      throw new CommandError("reset_demo is a human demo control, not an agent tool.");
    }
    ctx.setState(() => createInitialState({ story: story ?? "calm" }));
    return { reset: true, story: story ?? "calm" };
  },
};

/* -------------------------------------------------------------- registry */

export const COMMANDS: CommandDefinition[] = [
  inspectSystem,
  inspectResource,
  inspectWorkItem,
  getSimulationResults,
  compareScenariosCommand,
  createScenario,
  updateResource,
  updateWorkItem,
  routeWorkItem,
  runSimulation,
  activateScenario,
  resetDemo,
];

export const COMMAND_NAMES = COMMANDS.map((c) => c.name);

export function getCommand(name: string): CommandDefinition | undefined {
  return COMMANDS.find((c) => c.name === name);
}

/** The single entry point. Validates, runs, and never throws. */
export function executeCommand(
  ctx: CommandContext,
  name: string,
  input: unknown = {},
): CommandResult {
  const command = getCommand(name);
  if (!command) {
    return {
      ok: false,
      command: name,
      actor: ctx.actor,
      error: `Unknown command "${name}". Known: ${COMMAND_NAMES.join(", ")}.`,
    };
  }
  const parsed = command.input.safeParse(input ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
    return { ok: false, command: name, actor: ctx.actor, error: `Invalid input — ${detail}` };
  }
  try {
    return { ok: true, command: name, actor: ctx.actor, data: command.run(ctx, parsed.data) };
  } catch (error) {
    return {
      ok: false,
      command: name,
      actor: ctx.actor,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function findTechnicianName(scenario: Scenario, id: string): string {
  return findTechnician(scenario, id)?.name ?? id;
}
