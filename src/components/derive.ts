/**
 * Derives what the floor looks like at one minute of the shift from the
 * scenario plus (when available) the cached simulation. Pure helpers shared by
 * the Board, the Floor, the strips and the popovers — nobody re-derives state.
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

/* ------------------------------------------------- board / strip helpers */

export interface LaneBlock {
  workItemId: string;
  name: string;
  vehicle: string;
  kind: VehicleKind;
  operation: string;
  technicianId: string;
  start: number;
  end: number;
  /** Promised and finishing after the promise. */
  late: boolean;
}

export interface Lane {
  resourceId: string;
  name: string;
  /** Hatched window while the resource is blocked, if any. */
  blocked: { start: number; end: number; reason: string } | null;
  blocks: LaneBlock[];
}

export type VehicleKind = "car" | "van" | "pickup";

/** Vehicle silhouette family from the fixture's free-text vehicle name. */
export function vehicleKind(vehicle: string): VehicleKind {
  const v = vehicle.toLowerCase();
  if (v.includes("pickup")) return "pickup";
  if (v.includes("van")) return "van";
  return "car";
}

/** One lane per resource, blocks straight from the engine's segments. */
export function lanes(scenario: Scenario, result: SimulationResult | null): Lane[] {
  return scenario.resources.map((resource) => {
    const blocked =
      resource.blockedUntilMinute !== null && resource.blockedUntilMinute > scenario.clock.startMinute
        ? {
            start: scenario.clock.startMinute,
            end: resource.blockedUntilMinute,
            reason: resource.blockingReason ?? "unavailable",
          }
        : null;
    const blocks: LaneBlock[] = (result?.segments ?? [])
      .filter((s) => s.resourceId === resource.id)
      .map((s) => {
        const item = scenario.workItems.find((w) => w.id === s.workItemId)!;
        const outcome = result?.workItems.find((w) => w.workItemId === s.workItemId);
        return {
          workItemId: item.id,
          name: item.name,
          vehicle: item.vehicle,
          kind: vehicleKind(item.vehicle),
          operation: s.operation,
          technicianId: s.technicianId,
          start: s.start,
          end: s.end,
          late: outcome?.onTime === false,
        };
      })
      .sort((a, b) => a.start - b.start);
    return { resourceId: resource.id, name: resource.name, blocked, blocks };
  });
}

export interface PromiseChip {
  workItemId: string;
  vehicle: string;
  kind: VehicleKind;
  dueMinute: number;
  tone: "kept" | "missed" | "open";
}

/** The six promised cars in due order, for the top strip. */
export function promiseChips(scenario: Scenario, result: SimulationResult | null): PromiseChip[] {
  return scenario.workItems
    .filter((w) => w.dueMinute !== null)
    .sort((a, b) => a.dueMinute! - b.dueMinute! || (a.id < b.id ? -1 : 1))
    .map((w) => {
      const tone = promiseTone(w, result);
      return {
        workItemId: w.id,
        vehicle: w.vehicle,
        kind: vehicleKind(w.vehicle),
        dueMinute: w.dueMinute!,
        tone: tone === "none" ? "open" : tone,
      };
    });
}

export interface LiveFigures {
  carsInShop: number;
  baysBusy: number;
  baysTotal: number;
  technicians: number;
  technicianUtilization: number | null;
  avgWaitMinutes: number | null;
  bookedTodayUsd: number;
  partsOnOrder: number;
  partsLate: number;
}

/** The bottom-edge strip: light, live, never explanatory. */
export function liveFigures(
  scenario: Scenario,
  result: SimulationResult | null,
  floor: FloorView,
): LiveFigures {
  const bays = scenario.resources.filter((r) => r.type === "bay");
  const blocked = scenario.resources.filter(
    (r) => r.blockedUntilMinute !== null && r.blockedUntilMinute > floor.minute,
  );
  return {
    carsInShop: scenario.workItems.length,
    baysBusy: bays.filter((b) => floor.bays[b.id]?.status === "working").length,
    baysTotal: bays.length,
    technicians: scenario.technicians.length,
    technicianUtilization: result ? result.totals.technicianUtilization : null,
    avgWaitMinutes: result ? Math.round(result.totals.avgWaitMinutes) : null,
    bookedTodayUsd: scenario.workItems.reduce((s, w) => s + w.revenue, 0),
    partsOnOrder: blocked.length,
    partsLate: blocked.length,
  };
}

