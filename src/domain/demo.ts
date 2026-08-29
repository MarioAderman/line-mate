/**
 * The three demo beats (docs/demo-scenario.md), expressed as data so the
 * simulation tests, the command tests and the UI all agree on what "the
 * agent plan" and "the human decision" are.
 *
 * These are schedule changes only — no overtime, no extra technicians, no
 * cancelled jobs — and each beat is applied on top of the previous one.
 */
import type { Plan, PlanChange, Scenario } from "./types";

/** Alias kept for the simulation tests; the canonical type is `PlanChange`. */
export type ScheduleChange = PlanChange;

export interface DemoBeat {
  id: "agent-plan" | "human-decision";
  scenarioName: string;
  description: string;
  changes: ScheduleChange[];
  /** Promises the beat is expected to keep, out of six. */
  expectedPromisesMet: number;
}

/** Beat 2: the agent protects every promised job and frees the wagon from Bay 3. */
export const AGENT_PLAN: DemoBeat = {
  id: "agent-plan",
  scenarioName: "Agent plan",
  description:
    "Promised jobs move ahead of walk-ins and the black wagon stops waiting for Bay 3.",
  changes: [
    { command: "update_work_item", workItemId: "veh-01", priority: 1 },
    { command: "update_work_item", workItemId: "veh-02", priority: 1 },
    { command: "update_work_item", workItemId: "veh-03", priority: 1 },
    { command: "update_work_item", workItemId: "veh-04", priority: 1 },
    { command: "update_work_item", workItemId: "veh-05", priority: 1 },
    { command: "update_work_item", workItemId: "veh-06", priority: 1 },
    { command: "route_work_item", workItemId: "veh-05", resourceId: null, position: null },
  ],
  expectedPromisesMet: 5,
};

/** Beat 3: the manager puts the white SUV into Bay 3 the moment it opens (frees Bay 2 for the wagon). */
export const HUMAN_DECISION: DemoBeat = {
  id: "human-decision",
  scenarioName: "Human + agent",
  description:
    "The white SUV takes Bay 3 first when the part arrives; the van waits its turn.",
  changes: [
    { command: "route_work_item", workItemId: "veh-03", resourceId: "bay-3", position: 1 },
  ],
  expectedPromisesMet: 6,
};

export const BASELINE_EXPECTED_PROMISES = 4;

/**
 * Applies a schedule change to a scenario copy without validation. The
 * command layer is the validated path; this exists so pure simulation tests
 * can express the demo without depending on commands.
 */
export function applyScheduleChange(scenario: Scenario, change: ScheduleChange): Scenario {
  const next = structuredClone(scenario);
  const item = next.workItems.find((w) => w.id === change.workItemId);
  if (!item) throw new Error(`Unknown work item "${change.workItemId}".`);
  if (change.command === "update_work_item") {
    item.priority = change.priority;
  } else {
    item.route = { resourceId: change.resourceId, position: change.position };
  }
  return next;
}

export function applyDemoBeat(scenario: Scenario, beat: DemoBeat): Scenario {
  return beat.changes.reduce(applyScheduleChange, scenario);
}

/** A beat as the plan the commands and the exploration engine work with. */
export function planFromBeat(beat: DemoBeat): Plan {
  return { id: `PLAN-${beat.id}`, label: beat.scenarioName, changes: beat.changes };
}

export const AGENT_PLAN_AS_PLAN: Plan = planFromBeat(AGENT_PLAN);
export const HUMAN_DECISION_AS_PLAN: Plan = planFromBeat(HUMAN_DECISION);

