import type { Clock } from "@/domain";

export const SIMULATION_EVENT_TYPES = [
  "arrival",
  "start",
  "completion",
  "blocked",
  "released",
  "shift_end",
] as const;
export type SimulationEventType = (typeof SIMULATION_EVENT_TYPES)[number];

export interface SimulationEvent {
  minute: number;
  type: SimulationEventType;
  workItemId?: string;
  resourceId?: string;
  technicianId?: string;
  stepIndex?: number;
  note?: string;
}

/** One occupancy block: a step of a work item ran on a resource with a tech. */
export interface Segment {
  workItemId: string;
  resourceId: string;
  technicianId: string;
  stepIndex: number;
  operation: string;
  start: number;
  end: number;
}

export interface ResourceStat {
  resourceId: string;
  name: string;
  busyMinutes: number;
  blockedMinutes: number;
  idleMinutes: number;
  /** busy / (open minutes * capacity), clamped to [0, 1]. */
  utilization: number;
  queuePeak: number;
  jobs: number;
  costUsd: number;
}

export interface TechnicianStat {
  technicianId: string;
  name: string;
  busyMinutes: number;
  idleMinutes: number;
  utilization: number;
  jobs: number;
  laborCostUsd: number;
}

export type WorkItemOutcomeStatus = "completed" | "unfinished";

export interface WorkItemOutcome {
  workItemId: string;
  name: string;
  vehicle: string;
  promised: boolean;
  dueMinute: number | null;
  arrivalMinute: number;
  startMinute: number | null;
  completionMinute: number | null;
  status: WorkItemOutcomeStatus;
  /** null when the item carries no promise. */
  onTime: boolean | null;
  lateMinutes: number;
  waitMinutes: number;
  leadTimeMinutes: number | null;
  stepsCompleted: number;
  stepsTotal: number;
}

export interface Bottleneck {
  kind: "resource" | "technician";
  id: string;
  name: string;
  utilization: number;
  reason: string;
}

export interface SimulationTotals {
  completed: number;
  total: number;
  promisesMet: number;
  promisedTotal: number;
  revenueUsd: number;
  laborCostUsd: number;
  resourceCostUsd: number;
  avgLeadTimeMinutes: number;
  avgWaitMinutes: number;
  bayUtilization: number;
  technicianUtilization: number;
  lateWorkItems: string[];
  unfinishedWorkItems: string[];
  bottleneck: Bottleneck | null;
  constraintViolations: string[];
}

export interface SimulationResult {
  scenarioId: string;
  scenarioName: string;
  /** Bumped whenever engine semantics change; cached results compare on it. */
  engineVersion: number;
  clock: Clock;
  totals: SimulationTotals;
  resources: ResourceStat[];
  technicians: TechnicianStat[];
  workItems: WorkItemOutcome[];
  segments: Segment[];
  timeline: SimulationEvent[];
  warnings: string[];
}
