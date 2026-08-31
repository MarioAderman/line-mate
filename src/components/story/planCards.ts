/**
 * Turns a `Plan` and a `ShiftNote` into the few readable cards and chips the
 * story panels draw. Pure and React-free: the panels render what these return,
 * they never re-derive anything of their own.
 */
import {
  formatMinute,
  type NoteChannel,
  type Plan,
  type PlanChange,
  type Scenario,
  type ShiftNote,
} from "@/domain";
import { vehicleKind, type VehicleKind } from "@/components/derive";

export interface PlanCard {
  id: string;
  /** Headline of the change, e.g. "White SUV → Bay 3". */
  title: string;
  detail: string;
  /** Time chip: when the change bites. */
  timeLabel: string;
  kind: "priority" | "route";
  /** Set on route cards; what a drag drops on a lane. */
  workItemId: string | null;
  resourceId: string | null;
  position: number | null;
  vehicleKind: VehicleKind | null;
}

function vehicleName(scenario: Scenario, workItemId: string): string {
  return scenario.workItems.find((w) => w.id === workItemId)?.vehicle ?? workItemId;
}

function resourceName(scenario: Scenario, resourceId: string): string {
  return scenario.resources.find((r) => r.id === resourceId)?.name ?? resourceId;
}

/** A routing change bites when the target bay frees up, otherwise right now. */
function routeMinute(scenario: Scenario, resourceId: string | null): number {
  const resource = resourceId
    ? scenario.resources.find((r) => r.id === resourceId)
    : undefined;
  const blocked = resource?.blockedUntilMinute ?? null;
  return blocked !== null && blocked > scenario.clock.startMinute
    ? blocked
    : scenario.clock.startMinute;
}

function priorityCard(changes: PlanChange[], scenario: Scenario): PlanCard {
  const vehicles = changes
    .filter((c) => c.command === "update_work_item")
    .map((c) => vehicleName(scenario, c.workItemId));
  return {
    id: "plan-priority",
    title: "Promised cars first",
    detail:
      vehicles.length > 3
        ? `${vehicles.length} promised jobs move ahead of the walk-ins.`
        : `${vehicles.join(", ")} move ahead of the walk-ins.`,
    timeLabel: formatMinute(scenario.clock.startMinute),
    kind: "priority",
    workItemId: null,
    resourceId: null,
    position: null,
    vehicleKind: null,
  };
}

function routeCard(change: PlanChange & { command: "route_work_item" }, scenario: Scenario): PlanCard {
  const vehicle = vehicleName(scenario, change.workItemId);
  const target = change.resourceId === null ? null : resourceName(scenario, change.resourceId);
  // A job that is *in* the blocked bay rolls off it; one merely routed to it
  // simply stops waiting. Same command, two very different shop-floor moves.
  const onTheLift = scenario.workItems.find((w) => w.id === change.workItemId)?.status === "blocked";
  return {
    id: `plan-route-${change.workItemId}`,
    title: target === null ? `${vehicle} → any open bay` : `${vehicle} → ${target}`,
    detail:
      target === null
        ? onTheLift
          ? "Rolls off the blocked lift and finishes in the first bay that frees up."
          : "Stops waiting for the blocked bay and takes the first one that frees up."
        : change.position === 1
          ? `First into ${target} the moment it opens.`
          : `Runs in ${target}${change.position === null ? "" : `, position ${change.position}`}.`,
    timeLabel: formatMinute(routeMinute(scenario, change.resourceId)),
    kind: "route",
    workItemId: change.workItemId,
    resourceId: change.resourceId,
    position: change.position,
    vehicleKind: vehicleKind(vehicle),
  };
}

/**
 * One card per idea, not one per command: the six identical priority bumps
 * collapse into a single card, each routing decision keeps its own.
 */
export function planCards(plan: Plan, scenario: Scenario): PlanCard[] {
  const cards: PlanCard[] = [];
  const priorities = plan.changes.filter((c) => c.command === "update_work_item");
  if (priorities.length > 0) cards.push(priorityCard(priorities, scenario));
  for (const change of plan.changes) {
    if (change.command === "route_work_item") cards.push(routeCard(change, scenario));
  }
  return cards;
}

/** Bays a plan card can be dropped on: the ones that can run the job's steps. */
export function eligibleResourceIds(scenario: Scenario, workItemId: string): string[] {
  const item = scenario.workItems.find((w) => w.id === workItemId);
  if (!item) return [];
  return scenario.resources
    .filter((r) => item.steps.some((s) => s.requiredResourceType === r.type))
    .map((r) => r.id);
}

/** "No overtime · no extra technician · nothing cancelled", straight from the constraints. */
export function constraintsLine(scenario: Scenario): string {
  const { overtimeAllowed, cancellationsAllowed } = scenario.constraints;
  return [
    overtimeAllowed ? "Overtime allowed" : "No overtime",
    "no extra technician",
    cancellationsAllowed ? "cancellations allowed" : "nothing cancelled",
  ].join(" · ");
}

/* ------------------------------------------------------------- notifications */

export interface NoteChip {
  channel: NoteChannel;
  label: string;
  detail: string;
}

export const SLACK_CHANNEL = "#shop-floor";

/**
 * Customers who get a text: the promised cars the plan actually moves. On the
 * demo plan that is the wagon and the SUV — the two promises that were at risk.
 */
export function textedCustomerIds(plan: Plan, scenario: Scenario): string[] {
  const moved = new Set(
    plan.changes.filter((c) => c.command === "route_work_item").map((c) => c.workItemId),
  );
  return scenario.workItems
    .filter((w) => w.dueMinute !== null && moved.has(w.id))
    .map((w) => w.id);
}

/** The chips under "Team notified" — rendered state, nothing is ever sent. */
export function noteChips(note: ShiftNote, customerCount: number): NoteChip[] {
  return note.channels.map((channel) => {
    if (channel === "slack") {
      return { channel, label: "Slack", detail: SLACK_CHANNEL };
    }
    if (channel === "email") {
      return {
        channel,
        label: "Email",
        detail: note.recipients.length > 0 ? note.recipients.join(", ") : "Shift leads",
      };
    }
    return { channel, label: "Customer SMS", detail: String(customerCount) };
  });
}
