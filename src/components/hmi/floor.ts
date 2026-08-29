/**
 * Derives what the floor looks like at one minute of the shift from the
 * scenario plus (when available) the cached simulation. Pure helpers: the
 * canvas, the waiting column and the inspector all read the same picture.
 */
import { formatMinute, type Scenario, type WorkItem } from "@/domain";
import type { Segment, SimulationResult } from "@/simulation";

export type ActorTone = "human" | "agent" | "simulation";

export interface BayView {
  resourceId: string;
  status: "idle" | "working" | "blocked" | "down";
  statusLabel: string;
  current: {
    workItem: WorkItem;
    technicianName: string;
    operation: string;
    progress: number;
    endsAt: string;
  } | null;
  queued: WorkItem[];
}

export interface FloorView {
  minute: number;
  bays: Record<string, BayView>;
  waiting: WorkItem[];
  completed: WorkItem[];
  busyTechnicianIds: Set<string>;
}

export function segmentsAt(result: SimulationResult | null, minute: number): Segment[] {
  if (!result) return [];
  return result.segments.filter((s) => s.start <= minute && s.end > minute);
}

export function floorAt(
  scenario: Scenario,
  result: SimulationResult | null,
  minute: number,
): FloorView {
  const live = segmentsAt(result, minute);
  const bays: Record<string, BayView> = {};
  const busyTechnicianIds = new Set(live.map((s) => s.technicianId));

  for (const resource of scenario.resources) {
    const seg = live.find((s) => s.resourceId === resource.id);
    const blocked =
      resource.blockedUntilMinute !== null && resource.blockedUntilMinute > minute;
    const queued = scenario.workItems.filter(
      (w) =>
        w.route.resourceId === resource.id &&
        !live.some((s) => s.workItemId === w.id) &&
        !isDone(result, w.id, minute),
    );
    const item = seg ? scenario.workItems.find((w) => w.id === seg.workItemId) : undefined;
    const tech = seg ? scenario.technicians.find((t) => t.id === seg.technicianId) : undefined;
    const status = resource.status === "down" ? "down" : blocked ? "blocked" : seg ? "working" : "idle";
    bays[resource.id] = {
      resourceId: resource.id,
      status,
      statusLabel:
        status === "blocked"
          ? `Blocked until ${formatMinute(resource.blockedUntilMinute!)}`
          : status === "down"
            ? "Out of service"
            : status === "working"
              ? "Working"
              : "Idle",
      current:
        seg && item
          ? {
              workItem: item,
              technicianName: tech?.name ?? seg.technicianId,
              operation: seg.operation,
              progress: (minute - seg.start) / (seg.end - seg.start),
              endsAt: formatMinute(seg.end),
            }
          : null,
      queued,
    };
  }

  const waiting = scenario.workItems.filter(
    (w) =>
      Math.max(w.arrivalMinute, scenario.clock.startMinute) <= minute &&
      !live.some((s) => s.workItemId === w.id) &&
      !isDone(result, w.id, minute),
  );
  const completed = scenario.workItems.filter((w) => isDone(result, w.id, minute));

  return { minute, bays, waiting, completed, busyTechnicianIds };
}

function isDone(result: SimulationResult | null, workItemId: string, minute: number): boolean {
  const outcome = result?.workItems.find((w) => w.workItemId === workItemId);
  return Boolean(outcome?.completionMinute !== null && outcome && outcome.completionMinute! <= minute);
}

export function workMinutes(item: WorkItem): number {
  return item.steps.reduce((s, step) => s + step.durationMinutes, 0);
}

export function promiseTone(
  item: WorkItem,
  result: SimulationResult | null,
): "none" | "kept" | "missed" | "open" {
  if (item.dueMinute === null) return "none";
  const outcome = result?.workItems.find((w) => w.workItemId === item.id);
  if (!outcome) return "open";
  return outcome.onTime ? "kept" : "missed";
}

export const ACTOR_LABEL: Record<ActorTone, string> = {
  human: "You",
  agent: "Agent",
  simulation: "Sim",
};

export function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
