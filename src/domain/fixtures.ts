/**
 * The demo fixture (docs/simulation-model.md): Friday 14:15 at a mid-market
 * repair shop. Three bays, a diagnostics station, three technicians, twelve
 * vehicles. Six customers were promised their car before closing at 18:00;
 * the schedule as it stands finishes four of them on time.
 *
 * Every value is frozen so simulation output and server/client renders are
 * byte-identical.
 */
import { ScenarioSchema, type ProcessStep, type Scenario } from "./types";
import { PART_DELAY, applyDisruption } from "./disruptions";

export const BASELINE_SCENARIO_ID = "SCN-BASELINE";
export const FIXTURE_CREATED_AT = "2026-08-28T14:15:00.000Z";

/** 14:15 and 18:00 in minutes of day. */
export const SHIFT_START = 14 * 60 + 15;
export const SHIFT_END = 18 * 60;

const t = (h: number, m = 0) => h * 60 + m;

const step = (
  operation: string,
  durationMinutes: number,
  requiredSkill: ProcessStep["requiredSkill"],
  requiredResourceType: ProcessStep["requiredResourceType"] = "bay",
): ProcessStep => ({ operation, durationMinutes, requiredSkill, requiredResourceType });

const baseline: Scenario = ScenarioSchema.parse({
  id: BASELINE_SCENARIO_ID,
  name: "Baseline",
  description: "The schedule as the shop is running it right now.",
  createdAt: FIXTURE_CREATED_AT,
  parentId: null,
  clock: { dayLabel: "Friday", startMinute: SHIFT_START, endMinute: SHIFT_END },
  constraints: { overtimeAllowed: false, maxTechnicians: 3, cancellationsAllowed: false },
  resources: [
    {
      id: "bay-1",
      name: "Bay 1",
      type: "bay",
      position: { x: 0, y: 0 },
      capacity: 1,
      availability: 1,
      costPerHour: 18,
      status: "idle",
      blockedUntilMinute: null,
      blockingReason: null,
    },
    {
      id: "bay-2",
      name: "Bay 2",
      type: "bay",
      position: { x: 260, y: 0 },
      capacity: 1,
      availability: 1,
      costPerHour: 18,
      status: "idle",
      blockedUntilMinute: null,
      blockingReason: null,
    },
    {
      id: "bay-3",
      name: "Bay 3",
      type: "bay",
      position: { x: 520, y: 0 },
      capacity: 1,
      availability: 1,
      costPerHour: 18,
      status: "idle",
      blockedUntilMinute: null,
      blockingReason: null,
    },
    {
      id: "diag-1",
      name: "Diagnostics",
      type: "station",
      position: { x: 780, y: 0 },
      capacity: 1,
      availability: 1,
      costPerHour: 12,
      status: "idle",
      blockedUntilMinute: null,
      blockingReason: null,
    },
  ],
  technicians: [
    {
      id: "tech-carlos",
      name: "Carlos",
      skills: ["brakes", "suspension"],
      shiftStartMinute: SHIFT_START,
      shiftEndMinute: SHIFT_END,
      costPerHour: 42,
    },
    {
      id: "tech-ana",
      name: "Ana",
      skills: ["diagnostics", "electrical", "general"],
      shiftStartMinute: SHIFT_START,
      shiftEndMinute: SHIFT_END,
      costPerHour: 45,
    },
    {
      id: "tech-luis",
      name: "Luis",
      skills: ["general", "oil", "tires", "brakes"],
      shiftStartMinute: SHIFT_START,
      shiftEndMinute: SHIFT_END,
      costPerHour: 36,
    },
  ],
  workItems: [
    // ---- promised before closing -------------------------------------
    {
      id: "veh-01",
      name: "Oil change",
      vehicle: "Silver hatchback",
      priority: 3,
      arrivalMinute: t(13, 40),
      dueMinute: t(15, 30),
      revenue: 60,
      steps: [step("Oil & filter", 30, "oil")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-02",
      name: "Front brake pads",
      vehicle: "Blue sedan",
      priority: 3,
      arrivalMinute: t(13, 55),
      dueMinute: t(16, 0),
      revenue: 240,
      steps: [step("Brake pads & rotors", 90, "brakes")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-03",
      name: "Intermittent electrical fault",
      vehicle: "White SUV",
      priority: 3,
      arrivalMinute: t(14, 0),
      dueMinute: t(17, 0),
      revenue: 320,
      steps: [
        step("Electrical diagnosis", 45, "diagnostics", "station"),
        step("Harness repair", 45, "electrical"),
      ],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-04",
      name: "Tire rotation & balance",
      vehicle: "Grey pickup",
      priority: 3,
      arrivalMinute: t(14, 5),
      dueMinute: t(16, 30),
      revenue: 80,
      steps: [step("Rotate & balance", 40, "tires")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-05",
      name: "Rear suspension",
      vehicle: "Black wagon",
      priority: 3,
      arrivalMinute: t(14, 10),
      dueMinute: t(18, 0),
      revenue: 410,
      steps: [step("Shocks & bushings", 90, "suspension")],
      status: "waiting",
      route: { resourceId: "bay-3", position: null },
    },
    {
      id: "veh-06",
      name: "Brake inspection & rear pads",
      vehicle: "Red coupe",
      priority: 3,
      arrivalMinute: t(14, 12),
      dueMinute: t(17, 30),
      revenue: 210,
      steps: [step("Brake inspection", 20, "brakes"), step("Rear pads", 60, "brakes")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    // ---- walk-ins, no promise ----------------------------------------
    {
      id: "veh-07",
      name: "Oil change",
      vehicle: "Green minivan",
      priority: 2,
      arrivalMinute: t(13, 30),
      dueMinute: null,
      revenue: 60,
      steps: [step("Oil & filter", 30, "oil")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-08",
      name: "Pre-purchase inspection",
      vehicle: "Beige sedan",
      priority: 3,
      arrivalMinute: t(13, 35),
      dueMinute: null,
      revenue: 120,
      steps: [step("Multi-point inspection", 45, "general")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-09",
      name: "Coolant flush",
      vehicle: "Orange hatchback",
      priority: 3,
      arrivalMinute: t(13, 50),
      dueMinute: null,
      revenue: 110,
      steps: [step("Coolant flush", 40, "general")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-10",
      name: "Check-engine light",
      vehicle: "Silver crossover",
      priority: 3,
      arrivalMinute: t(14, 0),
      dueMinute: null,
      revenue: 90,
      steps: [step("OBD diagnosis", 45, "diagnostics", "station")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-11",
      name: "Two new tires",
      vehicle: "Yellow compact",
      priority: 3,
      arrivalMinute: t(15, 15),
      dueMinute: null,
      revenue: 180,
      steps: [step("Mount & balance", 40, "tires")],
      status: "waiting",
      route: { resourceId: null, position: null },
    },
    {
      id: "veh-12",
      name: "Water pump",
      vehicle: "Brown van",
      priority: 1,
      arrivalMinute: t(11, 30),
      dueMinute: null,
      revenue: 380,
      // Calm: the pump is fitted and the job is in its final checks. The part
      // delay (disruptions.ts) resets this to a full 60-minute replacement.
      steps: [step("Water pump · final checks", 10, "general")],
      status: "waiting",
      route: { resourceId: "bay-3", position: 1 },
    },
  ],
});

/**
 * The calm shop at 14:15: same cars, same promises, the water pump on time so
 * Bay 3 is working. This is what the opening question sees.
 */
export function calmFixture(): Scenario {
  const calm = structuredClone(baseline);
  calm.description = "Friday 14:15. Six customer promises before closing; the floor is on plan.";
  return calm;
}

/**
 * The escalated baseline used by the demo: the calm shop plus the part delay.
 * Deep clone so callers can never mutate the shared fixture.
 */
export function workshopFixture(): Scenario {
  const escalated = applyDisruption(calmFixture(), PART_DELAY);
  escalated.description = "The schedule as the shop is running it right now. Bay 3 is waiting on a part.";
  return escalated;
}

/** The six customer promises, in due order. Handy for tests and the UI. */
export function promisedWorkItemIds(scenario: Scenario): string[] {
  return scenario.workItems
    .filter((w) => w.dueMinute !== null)
    .sort((a, b) => a.dueMinute! - b.dueMinute! || (a.id < b.id ? -1 : 1))
    .map((w) => w.id);
}
