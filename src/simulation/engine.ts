/**
 * Deterministic discrete-event simulation of the workshop.
 *
 * No randomness, no wall-clock reads, no React: the same scenario always
 * produces a byte-identical `SimulationResult`. The engine advances from
 * event to event (docs/simulation-model.md):
 *
 *   1. seed the queue with arrivals, bay releases and the shift end;
 *   2. advance the clock to the next event and apply everything at that minute;
 *   3. allocate waiting work by route position, priority, due time, arrival, id;
 *   4. schedule the completion events the allocation produced;
 *   5. stop at closing time and derive metrics from the timeline.
 *
 * A step needs one free slot on a resource of the right type (honouring the
 * work item's route pin) and one free technician holding the required skill.
 * With overtime disallowed a step only starts if it can finish before close.
 */
import {
  validateScenario,
  type Resource,
  type Scenario,
  type Technician,
  type WorkItem,
} from "@/domain";
import type {
  Bottleneck,
  ResourceStat,
  Segment,
  SimulationEvent,
  SimulationResult,
  TechnicianStat,
  WorkItemOutcome,
} from "./types";

export const ENGINE_VERSION = 2;

const MAX_EVENTS = 50_000;

interface QueuedEvent {
  minute: number;
  seq: number;
  type: "arrival" | "completion" | "released" | "shift_end";
  workItemId?: string;
  resourceId?: string;
  technicianId?: string;
  stepIndex?: number;
}

interface Job {
  item: WorkItem;
  stepIndex: number;
  /** Minute the current step became eligible to start. */
  waitingSince: number;
  arrivedAt: number;
  arrived: boolean;
  running: boolean;
  startMinute: number | null;
  completionMinute: number | null;
  waitMinutes: number;
}

interface Slot {
  resource: Resource;
  running: number;
  blockedUntil: number | null;
  busyMinutes: number;
  blockedMinutes: number;
  queuePeak: number;
  jobs: number;
}

interface Hands {
  technician: Technician;
  busy: boolean;
  busyMinutes: number;
  jobs: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sorted-descending array used as a min-queue; pop() is the earliest. */
function pushEvent(queue: QueuedEvent[], event: QueuedEvent): void {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const probe = queue[mid];
    const later = probe.minute - event.minute || probe.seq - event.seq;
    if (later > 0) low = mid + 1;
    else high = mid;
  }
  queue.splice(low, 0, event);
}

/** Dispatch rule: route position, priority, due time, arrival, id. */
function compareJobs(a: Job, b: Job): number {
  const posA = a.item.route.position ?? Number.POSITIVE_INFINITY;
  const posB = b.item.route.position ?? Number.POSITIVE_INFINITY;
  const dueA = a.item.dueMinute ?? Number.POSITIVE_INFINITY;
  const dueB = b.item.dueMinute ?? Number.POSITIVE_INFINITY;
  return (
    posA - posB ||
    a.item.priority - b.item.priority ||
    dueA - dueB ||
    a.item.arrivalMinute - b.item.arrivalMinute ||
    byId(a.item, b.item)
  );
}

/**
 * Technician preference: the most versatile free technician takes the job,
 * so specialists stay available for the work only they can do. Ties break
 * on id, which keeps allocation stable.
 */
function generalistsFirst(technicians: Technician[]): Technician[] {
  return [...technicians].sort(
    (a, b) => b.skills.length - a.skills.length || byId(a, b),
  );
}

/** Minutes a step occupies its resource and technician. */
export function stepMinutes(resource: Resource, durationMinutes: number): number {
  return Math.ceil(durationMinutes / resource.availability);
}

export function simulate(scenario: Scenario): SimulationResult {
  const warnings = validateScenario(scenario);
  const { startMinute, endMinute } = scenario.clock;
  const { overtimeAllowed } = scenario.constraints;

  const slots = new Map<string, Slot>();
  for (const resource of scenario.resources) {
    const blockedUntil =
      resource.blockedUntilMinute !== null && resource.blockedUntilMinute > startMinute
        ? resource.blockedUntilMinute
        : resource.status === "down"
          ? Number.POSITIVE_INFINITY
          : null;
    slots.set(resource.id, {
      resource,
      running: 0,
      blockedUntil,
      busyMinutes: 0,
      blockedMinutes: 0,
      queuePeak: 0,
      jobs: 0,
    });
  }

  const hands = new Map<string, Hands>();
  for (const technician of scenario.technicians) {
    hands.set(technician.id, { technician, busy: false, busyMinutes: 0, jobs: 0 });
  }

  const runnable = scenario.workItems.filter((item) => {
    const pinnedOk =
      item.route.resourceId === null || slots.has(item.route.resourceId);
    const skillsOk = item.steps.every((s) =>
      scenario.technicians.some((t) => t.skills.includes(s.requiredSkill)),
    );
    return pinnedOk && skillsOk;
  });
  if (runnable.length !== scenario.workItems.length) {
    warnings.push("Work items with impossible routes or skills were skipped.");
  }

  const jobs = new Map<string, Job>();
  const events: QueuedEvent[] = [];
  const timeline: SimulationEvent[] = [];
  const segments: Segment[] = [];
  let seq = 0;

  for (const item of runnable) {
    const arrivedAt = Math.max(item.arrivalMinute, startMinute);
    jobs.set(item.id, {
      item,
      stepIndex: 0,
      waitingSince: arrivedAt,
      arrivedAt,
      arrived: false,
      running: false,
      startMinute: null,
      completionMinute: null,
      waitMinutes: 0,
    });
    if (item.status !== "completed") {
      pushEvent(events, { minute: arrivedAt, seq: seq++, type: "arrival", workItemId: item.id });
    }
  }
  for (const slot of slots.values()) {
    if (slot.blockedUntil !== null && Number.isFinite(slot.blockedUntil)) {
      pushEvent(events, {
        minute: slot.blockedUntil,
        seq: seq++,
        type: "released",
        resourceId: slot.resource.id,
      });
    }
  }
  pushEvent(events, { minute: endMinute, seq: seq++, type: "shift_end" });

  /*
   * Resources a job's current step may run on, in stable order. A route pin
   * only binds the steps that can run on the pinned resource type; a job
   * pinned to a bay still visits the diagnostics station for its diagnosis.
   */
  const eligibleSlots = (job: Job): Slot[] => {
    const step = job.item.steps[job.stepIndex];
    const pinned =
      job.item.route.resourceId === null ? undefined : slots.get(job.item.route.resourceId);
    if (pinned && pinned.resource.type === step.requiredResourceType) return [pinned];
    return scenario.resources
      .filter((r) => r.type === step.requiredResourceType)
      .map((r) => slots.get(r.id)!);
  };

  const slotFree = (slot: Slot, minute: number) =>
    slot.running < slot.resource.capacity &&
    (slot.blockedUntil === null || slot.blockedUntil <= minute);

  const canFinish = (minute: number, duration: number) =>
    overtimeAllowed || minute + duration <= endMinute;

  const dispatch = (minute: number) => {
    const waiting = [...jobs.values()]
      .filter((j) => j.arrived && !j.running && j.completionMinute === null)
      .sort(compareJobs);

    // Queue depth per resource, measured before allocation.
    for (const slot of slots.values()) {
      const depth = waiting.filter((j) => eligibleSlots(j).includes(slot)).length;
      slot.queuePeak = Math.max(slot.queuePeak, depth);
    }

    for (const job of waiting) {
      const step = job.item.steps[job.stepIndex];
      const slot = eligibleSlots(job).find((s) => slotFree(s, minute));
      if (!slot) continue;
      const duration = stepMinutes(slot.resource, step.durationMinutes);
      if (!canFinish(minute, duration)) continue;
      const tech = generalistsFirst(scenario.technicians)
        .filter((t) => t.skills.includes(step.requiredSkill))
        .map((t) => hands.get(t.id)!)
        .find(
          (h) =>
            !h.busy &&
            h.technician.shiftStartMinute <= minute &&
            minute + duration <= h.technician.shiftEndMinute,
        );
      if (!tech) continue;

      const waited = minute - job.waitingSince;
      job.waitMinutes += waited;
      if (job.startMinute === null) job.startMinute = minute;
      job.running = true;
      slot.running += 1;
      slot.busyMinutes += duration;
      slot.jobs += 1;
      tech.busy = true;
      tech.busyMinutes += duration;
      tech.jobs += 1;

      segments.push({
        workItemId: job.item.id,
        resourceId: slot.resource.id,
        technicianId: tech.technician.id,
        stepIndex: job.stepIndex,
        operation: step.operation,
        start: minute,
        end: minute + duration,
      });
      timeline.push({
        minute,
        type: "start",
        workItemId: job.item.id,
        resourceId: slot.resource.id,
        technicianId: tech.technician.id,
        stepIndex: job.stepIndex,
        note: step.operation,
      });
      pushEvent(events, {
        minute: minute + duration,
        seq: seq++,
        type: "completion",
        workItemId: job.item.id,
        resourceId: slot.resource.id,
        technicianId: tech.technician.id,
        stepIndex: job.stepIndex,
      });
    }
  };

  let processed = 0;
  let closed = false;
  while (events.length > 0 && !closed) {
    if (processed++ > MAX_EVENTS) {
      warnings.push("Simulation aborted: event budget exhausted.");
      break;
    }
    const minute = events[events.length - 1].minute;

    // Apply every event at this minute before dispatching, so simultaneous
    // arrivals and completions compete under the priority rule.
    while (events.length > 0 && events[events.length - 1].minute === minute) {
      const event = events.pop()!;
      if (event.type === "shift_end") {
        timeline.push({ minute, type: "shift_end" });
        // With overtime allowed the floor keeps running until work runs out.
        closed = !overtimeAllowed;
        continue;
      }
      if (event.type === "released") {
        const slot = slots.get(event.resourceId!)!;
        slot.blockedMinutes += minute - startMinute;
        slot.blockedUntil = null;
        timeline.push({ minute, type: "released", resourceId: slot.resource.id });
        continue;
      }
      const job = jobs.get(event.workItemId!)!;
      if (event.type === "arrival") {
        job.arrived = true;
        job.waitingSince = minute;
        timeline.push({
          minute,
          type: job.item.status === "blocked" ? "blocked" : "arrival",
          workItemId: job.item.id,
          resourceId: job.item.route.resourceId ?? undefined,
          note: job.item.status === "blocked" ? "Waiting for a part" : undefined,
        });
        continue;
      }
      // completion
      const slot = slots.get(event.resourceId!)!;
      const tech = hands.get(event.technicianId!)!;
      slot.running -= 1;
      tech.busy = false;
      job.running = false;
      job.stepIndex += 1;
      job.waitingSince = minute;
      const done = job.stepIndex >= job.item.steps.length;
      if (done) job.completionMinute = minute;
      timeline.push({
        minute,
        type: "completion",
        workItemId: job.item.id,
        resourceId: slot.resource.id,
        technicianId: tech.technician.id,
        stepIndex: event.stepIndex,
        note: done ? "Job complete" : undefined,
      });
    }

    if (!closed) dispatch(minute);
  }

  /* ------------------------------------------------------------ metrics */
  const openMinutes = endMinute - startMinute;

  const workItems: WorkItemOutcome[] = [...jobs.values()]
    .map((job): WorkItemOutcome => {
      const promised = job.item.dueMinute !== null;
      const completed = job.completionMinute !== null;
      const late =
        promised && completed
          ? Math.max(0, job.completionMinute! - job.item.dueMinute!)
          : promised
            ? Math.max(0, endMinute - job.item.dueMinute!)
            : 0;
      return {
        workItemId: job.item.id,
        name: job.item.name,
        vehicle: job.item.vehicle,
        promised,
        dueMinute: job.item.dueMinute,
        arrivalMinute: job.arrivedAt,
        startMinute: job.startMinute,
        completionMinute: job.completionMinute,
        status: completed ? "completed" : "unfinished",
        onTime: promised ? completed && late === 0 : null,
        lateMinutes: late,
        waitMinutes: job.waitMinutes,
        leadTimeMinutes: completed ? job.completionMinute! - job.arrivedAt : null,
        stepsCompleted: job.stepIndex,
        stepsTotal: job.item.steps.length,
      };
    })
    .sort((a, b) => (a.workItemId < b.workItemId ? -1 : 1));

  const resources: ResourceStat[] = scenario.resources.map((resource) => {
    const slot = slots.get(resource.id)!;
    const available = Math.max(0, openMinutes - slot.blockedMinutes) * resource.capacity;
    return {
      resourceId: resource.id,
      name: resource.name,
      busyMinutes: slot.busyMinutes,
      blockedMinutes: slot.blockedMinutes,
      idleMinutes: Math.max(0, available - slot.busyMinutes),
      utilization: available > 0 ? round(Math.min(1, slot.busyMinutes / available), 4) : 0,
      queuePeak: slot.queuePeak,
      jobs: slot.jobs,
      costUsd: round((slot.busyMinutes / 60) * resource.costPerHour),
    };
  });

  const technicians: TechnicianStat[] = scenario.technicians.map((technician) => {
    const h = hands.get(technician.id)!;
    const shift = Math.max(
      0,
      Math.min(endMinute, technician.shiftEndMinute) -
        Math.max(startMinute, technician.shiftStartMinute),
    );
    return {
      technicianId: technician.id,
      name: technician.name,
      busyMinutes: h.busyMinutes,
      idleMinutes: Math.max(0, shift - h.busyMinutes),
      utilization: shift > 0 ? round(Math.min(1, h.busyMinutes / shift), 4) : 0,
      jobs: h.jobs,
      laborCostUsd: round((shift / 60) * technician.costPerHour),
    };
  });

  const completedItems = workItems.filter((w) => w.status === "completed");
  const promisedItems = workItems.filter((w) => w.promised);
  const promisesMet = promisedItems.filter((w) => w.onTime === true).length;
  const bays = resources.filter(
    (r) => scenario.resources.find((x) => x.id === r.resourceId)?.type === "bay",
  );
  const avg = (values: number[]) =>
    values.length ? round(values.reduce((s, v) => s + v, 0) / values.length) : 0;

  const constraintViolations: string[] = [];
  if (scenario.technicians.length > scenario.constraints.maxTechnicians) {
    constraintViolations.push("More technicians than the scenario allows.");
  }

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    engineVersion: ENGINE_VERSION,
    clock: scenario.clock,
    totals: {
      completed: completedItems.length,
      total: workItems.length,
      promisesMet,
      promisedTotal: promisedItems.length,
      revenueUsd: round(
        completedItems.reduce(
          (s, w) => s + (scenario.workItems.find((i) => i.id === w.workItemId)?.revenue ?? 0),
          0,
        ),
      ),
      laborCostUsd: round(technicians.reduce((s, t) => s + t.laborCostUsd, 0)),
      resourceCostUsd: round(resources.reduce((s, r) => s + r.costUsd, 0)),
      avgLeadTimeMinutes: avg(completedItems.map((w) => w.leadTimeMinutes!)),
      avgWaitMinutes: avg(workItems.filter((w) => w.startMinute !== null).map((w) => w.waitMinutes)),
      bayUtilization: avg(bays.map((r) => r.utilization)),
      technicianUtilization: avg(technicians.map((t) => t.utilization)),
      lateWorkItems: promisedItems.filter((w) => w.onTime === false).map((w) => w.workItemId),
      unfinishedWorkItems: workItems
        .filter((w) => w.status === "unfinished")
        .map((w) => w.workItemId),
      bottleneck: findBottleneck(scenario, resources, technicians),
      constraintViolations,
    },
    resources,
    technicians,
    workItems,
    segments,
    timeline,
    warnings,
  };
}

/** The most saturated thing on the floor, with a one-line reason. */
function findBottleneck(
  scenario: Scenario,
  resources: ResourceStat[],
  technicians: TechnicianStat[],
): Bottleneck | null {
  let best: Bottleneck | null = null;
  for (const r of resources) {
    const resource = scenario.resources.find((x) => x.id === r.resourceId)!;
    const reason =
      r.blockedMinutes > 0
        ? `${r.name} was blocked for ${r.blockedMinutes} min (${resource.blockingReason ?? "unavailable"}).`
        : `${r.name} ran ${r.busyMinutes} of its available minutes with a queue peaking at ${r.queuePeak}.`;
    if (!best || r.utilization > best.utilization) {
      best = { kind: "resource", id: r.resourceId, name: r.name, utilization: r.utilization, reason };
    }
  }
  for (const t of technicians) {
    const tech = scenario.technicians.find((x) => x.id === t.technicianId)!;
    const reason = `${t.name} (${tech.skills.join(", ")}) was busy ${t.busyMinutes} min across ${t.jobs} jobs.`;
    if (!best || t.utilization > best.utilization) {
      best = { kind: "technician", id: t.technicianId, name: t.name, utilization: t.utilization, reason };
    }
  }
  return best;
}

/* ------------------------------------------------------------- compare */

export interface ScenarioDelta {
  completed: number;
  promisesMet: number;
  revenueUsd: number;
  laborCostUsd: number;
  avgWaitMinutes: number;
  avgLeadTimeMinutes: number;
}

export interface ScenarioComparison {
  base: SimulationResult;
  candidate: SimulationResult;
  deltas: ScenarioDelta;
  /** Plain-language verdict, reused verbatim by the UI and the MCP tool. */
  verdict: string;
}

export function compareScenarios(base: Scenario, candidate: Scenario): ScenarioComparison {
  const b = simulate(base);
  const c = simulate(candidate);
  const deltas: ScenarioDelta = {
    completed: c.totals.completed - b.totals.completed,
    promisesMet: c.totals.promisesMet - b.totals.promisesMet,
    revenueUsd: round(c.totals.revenueUsd - b.totals.revenueUsd),
    laborCostUsd: round(c.totals.laborCostUsd - b.totals.laborCostUsd),
    avgWaitMinutes: round(c.totals.avgWaitMinutes - b.totals.avgWaitMinutes),
    avgLeadTimeMinutes: round(c.totals.avgLeadTimeMinutes - b.totals.avgLeadTimeMinutes),
  };
  const verdict =
    `${candidate.name} keeps ${c.totals.promisesMet} of ${c.totals.promisedTotal} promises ` +
    `versus ${b.totals.promisesMet} for ${base.name} ` +
    `(${deltas.promisesMet >= 0 ? "+" : ""}${deltas.promisesMet}), ` +
    `${deltas.revenueUsd >= 0 ? "+" : "-"}$${Math.abs(deltas.revenueUsd)} revenue, ` +
    `${c.totals.constraintViolations.length === 0 ? "no constraints broken" : "constraints broken"}.`;
  return { base: b, candidate: c, deltas, verdict };
}
