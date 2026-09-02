/**
 * What the inspector knows.
 *
 * Click is the commitment: the hover hint says what a thing is, the inspector
 * says everything the manager needs to decide about it. All of that is derived
 * here — pure, React-free and testable — from the scenario, the last
 * simulation and the one "now" (`store.playbackMinute`). Nothing in this file
 * owns a clock or recomputes the schedule; the engine's segments are the
 * source of every time on screen.
 */
import { formatMinute, type Scenario, type WorkItem } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { partName } from "@/components/frame/copy";
import { vehicleKind, workMinutes, type VehicleKind } from "@/components/derive";

/* ------------------------------------------------------------------ time */

/** "49 min" under an hour, "1 h 05" beyond it. Never negative. */
export function countdown(fromMinute: number, toMinute: number): string {
  const left = Math.max(0, Math.round(toMinute - fromMinute));
  if (left < 60) return `${left} min`;
  return `${Math.floor(left / 60)} h ${String(left % 60).padStart(2, "0")}`;
}

/* --------------------------------------------------------------- promises */

export type PromiseState = "kept" | "missed" | "open" | "none";

export interface PromiseFact {
  state: PromiseState;
  /** "16:00", or null for a walk-in. */
  dueLabel: string | null;
  /** "34 min margin", "22 min late", "not simulated yet", "no promise". */
  detail: string;
}

function promiseFact(item: WorkItem, simulation: SimulationResult | null): PromiseFact {
  if (item.dueMinute === null) {
    return { state: "none", dueLabel: null, detail: "walk-in · no promise" };
  }
  const dueLabel = formatMinute(item.dueMinute);
  const outcome = simulation?.workItems.find((w) => w.workItemId === item.id) ?? null;
  if (!outcome) return { state: "open", dueLabel, detail: "not simulated yet" };
  if (outcome.completionMinute === null) {
    return { state: "missed", dueLabel, detail: "does not finish today" };
  }
  if (outcome.onTime === false) {
    return { state: "missed", dueLabel, detail: `${outcome.lateMinutes} min late` };
  }
  return {
    state: "kept",
    dueLabel,
    detail: `${item.dueMinute - outcome.completionMinute} min margin`,
  };
}

/* ------------------------------------------------------------------ steps */

export type StepState = "done" | "live" | "todo";

export interface StepFact {
  index: number;
  operation: string;
  state: StepState;
  /** "26 / 45" while it runs, "15 min" otherwise. */
  detail: string;
  /** 0..1, only meaningful for the live step. */
  progress: number;
}

function stepFacts(
  item: WorkItem,
  simulation: SimulationResult | null,
  minute: number,
): StepFact[] {
  return item.steps.map((step, index) => {
    const segment =
      simulation?.segments.find((s) => s.workItemId === item.id && s.stepIndex === index) ?? null;
    if (segment && segment.end <= minute) {
      return {
        index,
        operation: step.operation,
        state: "done",
        detail: `${step.durationMinutes} min`,
        progress: 1,
      };
    }
    if (segment && segment.start <= minute) {
      const span = Math.max(1, segment.end - segment.start);
      return {
        index,
        operation: step.operation,
        state: "live",
        detail: `${Math.round(minute - segment.start)} / ${span}`,
        progress: Math.min(1, (minute - segment.start) / span),
      };
    }
    return {
      index,
      operation: step.operation,
      state: "todo",
      detail: segment ? `${formatMinute(segment.start)} · ${step.durationMinutes} min` : `${step.durationMinutes} min`,
      progress: 0,
    };
  });
}

/* ------------------------------------------------------------------ parts */

export interface PartsFact {
  waiting: boolean;
  /** "on hand", or "Water pump · eta 15:30 · 49 min". */
  label: string;
  /** The part's ETA, so a countdown can re-render with the clock. */
  etaMinute: number | null;
}

const ON_HAND: PartsFact = { waiting: false, label: "on hand", etaMinute: null };

/** The part that holds a resource, if one does at this minute. */
function partsForResource(
  scenario: Scenario,
  minute: number,
  resourceId: string | null,
): PartsFact {
  const resource = resourceId
    ? scenario.resources.find((r) => r.id === resourceId)
    : undefined;
  if (
    !resource ||
    resource.blockedUntilMinute === null ||
    resource.blockedUntilMinute <= minute ||
    !resource.blockingReason
  ) {
    return ON_HAND;
  }
  return {
    waiting: true,
    label: `${partName(resource.blockingReason)} · eta ${formatMinute(resource.blockedUntilMinute)} · ${countdown(
      minute,
      resource.blockedUntilMinute,
    )}`,
    etaMinute: resource.blockedUntilMinute,
  };
}

/* ------------------------------------------------------------- work items */

export interface TechnicianBadge {
  id: string;
  name: string;
  /** Single letter for the round badge. */
  initial: string;
  skills: string[];
}

export interface WorkItemInspection {
  kind: "workItem";
  id: string;
  vehicle: string;
  jobName: string;
  glyph: VehicleKind;
  priority: number;
  promise: PromiseFact;
  /** Whoever is on it now, or whoever the engine assigned it next. */
  technician: TechnicianBadge | null;
  steps: StepFact[];
  parts: PartsFact;
  /** "Bay 3 · position 1" or "any eligible bay". */
  route: string;
  workMinutes: number;
}

function badge(scenario: Scenario, technicianId: string): TechnicianBadge | null {
  const tech = scenario.technicians.find((t) => t.id === technicianId);
  if (!tech) return null;
  return { id: tech.id, name: tech.name, initial: tech.name.slice(0, 1), skills: tech.skills };
}

export function inspectWorkItem(
  scenario: Scenario,
  simulation: SimulationResult | null,
  minute: number,
  id: string,
): WorkItemInspection | null {
  const item = scenario.workItems.find((w) => w.id === id);
  if (!item) return null;

  const mine = (simulation?.segments ?? [])
    .filter((s) => s.workItemId === id)
    .sort((a, b) => a.start - b.start);
  // Prefer whoever is on the job right now; otherwise the next hand assigned.
  const live = mine.find((s) => s.start <= minute && s.end > minute) ?? null;
  const next = mine.find((s) => s.start > minute) ?? null;
  const assigned = live ?? next ?? mine[mine.length - 1] ?? null;

  const routeName =
    item.route.resourceId === null
      ? "any eligible bay"
      : `${scenario.resources.find((r) => r.id === item.route.resourceId)?.name ?? item.route.resourceId}` +
        (item.route.position === null ? "" : ` · position ${item.route.position}`);

  return {
    kind: "workItem",
    id: item.id,
    vehicle: item.vehicle,
    jobName: item.name,
    glyph: vehicleKind(item.vehicle),
    priority: item.priority,
    promise: promiseFact(item, simulation),
    technician: assigned ? badge(scenario, assigned.technicianId) : null,
    steps: stepFacts(item, simulation, minute),
    parts: partsForResource(scenario, minute, live?.resourceId ?? item.route.resourceId),
    route: routeName,
    workMinutes: workMinutes(item),
  };
}

/* --------------------------------------------------------------- resources */

export interface QueuedJob {
  workItemId: string;
  vehicle: string;
  glyph: VehicleKind;
  /** "15:30" when the engine scheduled it, else "queued". */
  startsAt: string;
  operation: string;
}

export interface ResourceInspection {
  kind: "resource";
  id: string;
  name: string;
  typeLabel: string;
  status: "idle" | "working" | "blocked" | "down";
  statusLabel: string;
  /** 0..1 of the shift, or null before the first run. */
  utilization: number | null;
  jobsToday: number | null;
  current: {
    workItemId: string;
    vehicle: string;
    glyph: VehicleKind;
    operation: string;
    technicianName: string;
    endsAt: string;
    /** 0..1 */
    progress: number;
    detail: string;
  } | null;
  /** The next three jobs, in the order the engine will take them. */
  next: QueuedJob[];
  parts: PartsFact;
}

const NEXT_JOBS = 3;

export function inspectResource(
  scenario: Scenario,
  simulation: SimulationResult | null,
  minute: number,
  id: string,
): ResourceInspection | null {
  const resource = scenario.resources.find((r) => r.id === id);
  if (!resource) return null;

  const here = (simulation?.segments ?? [])
    .filter((s) => s.resourceId === id)
    .sort((a, b) => a.start - b.start);
  const live = here.find((s) => s.start <= minute && s.end > minute) ?? null;
  const liveItem = live ? scenario.workItems.find((w) => w.id === live.workItemId) : undefined;
  const stat = simulation?.resources.find((r) => r.resourceId === id) ?? null;
  const blocked =
    resource.blockedUntilMinute !== null && resource.blockedUntilMinute > minute;
  const status = resource.status === "down" ? "down" : blocked ? "blocked" : live ? "working" : "idle";

  // Scheduled work first; before the first run, the jobs pinned here.
  const scheduled: QueuedJob[] = [];
  for (const segment of here) {
    if (segment.start <= minute) continue;
    if (scheduled.some((j) => j.workItemId === segment.workItemId)) continue;
    const item = scenario.workItems.find((w) => w.id === segment.workItemId);
    if (!item) continue;
    scheduled.push({
      workItemId: item.id,
      vehicle: item.vehicle,
      glyph: vehicleKind(item.vehicle),
      startsAt: formatMinute(segment.start),
      operation: segment.operation,
    });
    if (scheduled.length === NEXT_JOBS) break;
  }
  const pinned: QueuedJob[] =
    scheduled.length > 0
      ? []
      : scenario.workItems
          .filter((w) => w.route.resourceId === id && w.id !== live?.workItemId)
          .sort((a, b) => (a.route.position ?? 99) - (b.route.position ?? 99) || a.priority - b.priority)
          .slice(0, NEXT_JOBS)
          .map((w) => ({
            workItemId: w.id,
            vehicle: w.vehicle,
            glyph: vehicleKind(w.vehicle),
            startsAt: "queued",
            operation: w.steps[0]?.operation ?? w.name,
          }));

  return {
    kind: "resource",
    id: resource.id,
    name: resource.name,
    typeLabel: resource.type === "station" ? "Station" : "Bay",
    status,
    statusLabel:
      status === "blocked"
        ? `Blocked until ${formatMinute(resource.blockedUntilMinute as number)}`
        : status === "down"
          ? "Out of service"
          : status === "working"
            ? "Working"
            : "Idle",
    utilization: stat ? stat.utilization : null,
    jobsToday: stat ? stat.jobs : null,
    current:
      live && liveItem
        ? {
            workItemId: liveItem.id,
            vehicle: liveItem.vehicle,
            glyph: vehicleKind(liveItem.vehicle),
            operation: live.operation,
            technicianName:
              scenario.technicians.find((t) => t.id === live.technicianId)?.name ?? live.technicianId,
            endsAt: formatMinute(live.end),
            progress: Math.min(1, (minute - live.start) / Math.max(1, live.end - live.start)),
            detail: `${Math.round(minute - live.start)} / ${Math.max(1, live.end - live.start)}`,
          }
        : null,
    next: scheduled.length > 0 ? scheduled : pinned,
    parts: partsForResource(scenario, minute, resource.id),
  };
}

/* ------------------------------------------------------------- technicians */

export interface TechnicianInspection {
  kind: "technician";
  id: string;
  name: string;
  initial: string;
  skills: string[];
  /** "Bay 1 · Brake pads · ends 15:45" or "between jobs". */
  where: string;
  jobsToday: number | null;
  utilization: number | null;
  shift: string;
}

export function inspectTechnician(
  scenario: Scenario,
  simulation: SimulationResult | null,
  minute: number,
  id: string,
): TechnicianInspection | null {
  const tech = scenario.technicians.find((t) => t.id === id);
  if (!tech) return null;
  const stat = simulation?.technicians.find((t) => t.technicianId === id) ?? null;
  const live =
    (simulation?.segments ?? []).find(
      (s) => s.technicianId === id && s.start <= minute && s.end > minute,
    ) ?? null;
  const where = live
    ? `${scenario.resources.find((r) => r.id === live.resourceId)?.name ?? live.resourceId} · ${
        live.operation
      } · ends ${formatMinute(live.end)}`
    : "between jobs";
  return {
    kind: "technician",
    id: tech.id,
    name: tech.name,
    initial: tech.name.slice(0, 1),
    skills: tech.skills,
    where,
    jobsToday: stat ? stat.jobs : null,
    utilization: stat ? stat.utilization : null,
    shift: `${formatMinute(tech.shiftStartMinute)}–${formatMinute(tech.shiftEndMinute)}`,
  };
}

export type Inspection = WorkItemInspection | ResourceInspection | TechnicianInspection;

/* ------------------------------------------------------------- ask agent */

/**
 * WebMCP is pull-only: the page cannot push a question into ChatGPT. So the
 * inspector writes the question the manager would have typed, with the facts
 * already in it, and puts it on the clipboard.
 */
export function askAgentQuestion(
  inspection: Inspection,
  scenario: Scenario,
  minute: number,
): string {
  // The live minute, not the shift opening: the manager pastes this now, and
  // the agent must not read the start of the shift as the current time.
  const shop = `In Line-Mate (${scenario.name}, now ${formatMinute(minute)})`;
  if (inspection.kind === "workItem") {
    const promise =
      inspection.promise.dueLabel === null
        ? "it is a walk-in with no promise"
        : `it is promised at ${inspection.promise.dueLabel} (${inspection.promise.detail})`;
    const held = inspection.parts.waiting ? ` It is held by ${inspection.parts.label}.` : "";
    return (
      `${shop}: the ${inspection.vehicle} needs ${inspection.jobName.toLowerCase()} and ${promise}.` +
      `${held} Inspect it and tell me what to change to keep every promise, without overtime, ` +
      `an extra technician, or cancelling anything.`
    );
  }
  if (inspection.kind === "resource") {
    const load =
      inspection.utilization === null
        ? ""
        : ` It is at ${Math.round(inspection.utilization * 100)}% of the shift.`;
    const held = inspection.parts.waiting ? ` It is waiting for ${inspection.parts.label}.` : "";
    return (
      `${shop}: ${inspection.name} is ${inspection.statusLabel.toLowerCase()}.${held}${load} ` +
      `Which jobs should move off it, and what does that do to my six promises?`
    );
  }
  const load =
    inspection.utilization === null
      ? ""
      : ` at ${Math.round(inspection.utilization * 100)}% of the shift`;
  return (
    `${shop}: ${inspection.name} can do ${inspection.skills.join(", ")} and is ${inspection.where}${load}. ` +
    `Is the schedule using this technician well, and what would you reassign?`
  );
}
