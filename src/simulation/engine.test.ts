import { describe, expect, it } from "vitest";
import {
  AGENT_PLAN,
  BASELINE_EXPECTED_PROMISES,
  HUMAN_DECISION,
  ScenarioSchema,
  applyDemoBeat,
  workshopFixture,
  type Scenario,
} from "@/domain";
import { compareScenarios, simulate, stepMinutes } from "./engine";

/** Two bays, two technicians, a 120-minute shift. Small enough to hand-check. */
function tinyScenario(overrides: Partial<Scenario> = {}): Scenario {
  return ScenarioSchema.parse({
    id: "SCN-TINY",
    name: "Tiny",
    description: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    parentId: null,
    clock: { dayLabel: "Monday", startMinute: 0, endMinute: 120 },
    constraints: { overtimeAllowed: false, maxTechnicians: 2, cancellationsAllowed: false },
    resources: [
      bay("bay-a", "Bay A", 0),
      bay("bay-b", "Bay B", 100),
    ],
    technicians: [
      { id: "t-1", name: "One", skills: ["general", "brakes"], shiftStartMinute: 0, shiftEndMinute: 120, costPerHour: 60 },
      { id: "t-2", name: "Two", skills: ["general"], shiftStartMinute: 0, shiftEndMinute: 120, costPerHour: 60 },
    ],
    workItems: [job("w-1", 30, "general", 0, 60)],
    ...overrides,
  });
}

function bay(id: string, name: string, x: number) {
  return {
    id,
    name,
    type: "bay" as const,
    position: { x, y: 0 },
    capacity: 1,
    availability: 1,
    costPerHour: 10,
    status: "idle" as const,
    blockedUntilMinute: null,
    blockingReason: null,
  };
}

function job(
  id: string,
  minutes: number,
  skill: "general" | "brakes",
  arrival: number,
  due: number | null,
  priority = 3,
) {
  return {
    id,
    name: `Job ${id}`,
    vehicle: `Car ${id}`,
    priority,
    arrivalMinute: arrival,
    dueMinute: due,
    revenue: 100,
    steps: [
      { operation: "Work", durationMinutes: minutes, requiredResourceType: "bay" as const, requiredSkill: skill },
    ],
    status: "waiting" as const,
    route: { resourceId: null, position: null },
  };
}

describe("stepMinutes", () => {
  it("derates duration by availability and rounds up", () => {
    const resource = { ...bay("x", "X", 0), availability: 0.8 };
    expect(stepMinutes(resource, 30)).toBe(38);
  });
});

describe("simulate — allocation rules", () => {
  it("runs a single job and reports an exact schedule", () => {
    const result = simulate(tinyScenario());
    const [w] = result.workItems;
    expect(w.startMinute).toBe(0);
    expect(w.completionMinute).toBe(30);
    expect(w.onTime).toBe(true);
    expect(result.totals.completed).toBe(1);
    expect(result.totals.promisesMet).toBe(1);
    expect(result.totals.revenueUsd).toBe(100);
    expect(result.warnings).toEqual([]);
  });

  it("gives the most versatile free technician the job", () => {
    const result = simulate(tinyScenario());
    // t-1 has two skills, so it takes generic work before t-2.
    expect(result.segments[0].technicianId).toBe("t-1");
  });

  it("never double-books a technician or a bay", () => {
    const scenario = tinyScenario({
      workItems: [job("w-1", 40, "general", 0, null), job("w-2", 40, "general", 0, null), job("w-3", 40, "general", 0, null)],
    });
    const result = simulate(scenario);
    for (const probe of result.segments) {
      const sameTech = result.segments.filter(
        (s) => s !== probe && s.technicianId === probe.technicianId && s.start < probe.end && s.end > probe.start,
      );
      const sameBay = result.segments.filter(
        (s) => s !== probe && s.resourceId === probe.resourceId && s.start < probe.end && s.end > probe.start,
      );
      expect(sameTech).toEqual([]);
      expect(sameBay).toEqual([]);
    }
    expect(result.workItems.find((w) => w.workItemId === "w-3")!.startMinute).toBe(40);
  });

  it("dispatches by priority before due time", () => {
    const scenario = tinyScenario({
      workItems: [job("w-1", 30, "general", 0, 30, 3), job("w-2", 30, "general", 0, 90, 1)],
      technicians: [
        { id: "t-1", name: "One", skills: ["general"], shiftStartMinute: 0, shiftEndMinute: 120, costPerHour: 60 },
      ],
    });
    const result = simulate(scenario);
    expect(result.workItems.find((w) => w.workItemId === "w-2")!.startMinute).toBe(0);
    expect(result.workItems.find((w) => w.workItemId === "w-1")!.onTime).toBe(false);
  });

  it("dispatches by due time within the same priority", () => {
    const scenario = tinyScenario({
      workItems: [job("w-1", 30, "general", 0, 90), job("w-2", 30, "general", 0, 30)],
      technicians: [
        { id: "t-1", name: "One", skills: ["general"], shiftStartMinute: 0, shiftEndMinute: 120, costPerHour: 60 },
      ],
    });
    const result = simulate(scenario);
    expect(result.workItems.find((w) => w.workItemId === "w-2")!.startMinute).toBe(0);
  });

  it("requires a technician with the step's skill", () => {
    const scenario = tinyScenario({
      workItems: [job("w-1", 30, "brakes", 0, null), job("w-2", 30, "brakes", 0, null)],
    });
    const result = simulate(scenario);
    // Only t-1 can do brakes, so the second job waits for it.
    expect(result.workItems.find((w) => w.workItemId === "w-2")!.startMinute).toBe(30);
    expect(result.segments.every((s) => s.technicianId === "t-1")).toBe(true);
  });

  it("honours a route pin and a queue position", () => {
    const scenario = tinyScenario({
      workItems: [
        { ...job("w-1", 30, "general", 0, null, 1), route: { resourceId: "bay-b", position: null } },
        { ...job("w-2", 30, "general", 0, null, 5), route: { resourceId: "bay-b", position: 1 } },
      ],
    });
    const result = simulate(scenario);
    const w1 = result.workItems.find((w) => w.workItemId === "w-1")!;
    const w2 = result.workItems.find((w) => w.workItemId === "w-2")!;
    expect(result.segments.every((s) => s.resourceId === "bay-b")).toBe(true);
    expect(w2.startMinute).toBe(0);
    expect(w1.startMinute).toBe(30);
  });

  it("keeps a blocked bay out of play until it is released", () => {
    const scenario = tinyScenario({
      resources: [
        { ...bay("bay-a", "Bay A", 0), status: "blocked", blockedUntilMinute: 50, blockingReason: "Part" },
      ],
      technicians: [
        { id: "t-1", name: "One", skills: ["general"], shiftStartMinute: 0, shiftEndMinute: 120, costPerHour: 60 },
      ],
    });
    const result = simulate(scenario);
    expect(result.workItems[0].startMinute).toBe(50);
    expect(result.resources[0].blockedMinutes).toBe(50);
    expect(result.timeline.some((e) => e.type === "released" && e.minute === 50)).toBe(true);
  });

  it("does not start work that cannot finish before closing", () => {
    const scenario = tinyScenario({
      workItems: [job("w-1", 100, "general", 0, null), job("w-2", 100, "general", 0, null)],
      technicians: [
        { id: "t-1", name: "One", skills: ["general"], shiftStartMinute: 0, shiftEndMinute: 120, costPerHour: 60 },
      ],
    });
    const result = simulate(scenario);
    expect(result.totals.completed).toBe(1);
    expect(result.totals.unfinishedWorkItems).toEqual(["w-2"]);
    expect(result.workItems.find((w) => w.workItemId === "w-2")!.startMinute).toBeNull();
  });

  it("allows overtime when the constraint permits it", () => {
    const scenario = tinyScenario({
      constraints: { overtimeAllowed: true, maxTechnicians: 2, cancellationsAllowed: false },
      workItems: [job("w-1", 100, "general", 0, null), job("w-2", 100, "general", 0, null)],
      technicians: [
        { id: "t-1", name: "One", skills: ["general"], shiftStartMinute: 0, shiftEndMinute: 400, costPerHour: 60 },
      ],
    });
    expect(simulate(scenario).totals.completed).toBe(2);
  });

  it("charges wait time to the job", () => {
    const scenario = tinyScenario({
      workItems: [job("w-1", 30, "general", 0, null, 1), job("w-2", 30, "general", 0, null, 2)],
      technicians: [
        { id: "t-1", name: "One", skills: ["general"], shiftStartMinute: 0, shiftEndMinute: 120, costPerHour: 60 },
      ],
    });
    const result = simulate(scenario);
    expect(result.workItems.find((w) => w.workItemId === "w-2")!.waitMinutes).toBe(30);
    expect(result.totals.avgWaitMinutes).toBe(15);
  });

  it("reports impossible skills as warnings instead of throwing", () => {
    const broken = workshopFixture();
    broken.technicians = broken.technicians.filter((t) => t.id !== "tech-ana");
    const result = simulate(broken);
    expect(result.warnings.join(" ")).toContain("diagnostics");
  });
});

describe("simulate — determinism", () => {
  it("is byte-identical across runs of the workshop fixture", () => {
    const a = simulate(workshopFixture());
    const b = simulate(workshopFixture());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.warnings).toEqual([]);
  });

  it("is insensitive to the declaration order of work items", () => {
    const forward = workshopFixture();
    const reversed = workshopFixture();
    reversed.workItems.reverse();
    expect(simulate(reversed).totals).toEqual(simulate(forward).totals);
  });

  it("never overlaps more segments than a bay has slots", () => {
    const result = simulate(workshopFixture());
    for (const resource of workshopFixture().resources) {
      const segments = result.segments.filter((s) => s.resourceId === resource.id);
      for (const probe of segments) {
        const overlapping = segments.filter((s) => s.start <= probe.start && s.end > probe.start).length;
        expect(overlapping).toBeLessThanOrEqual(resource.capacity);
      }
    }
  });
});

describe("the demo story", () => {
  const baseline = workshopFixture();
  const agentPlan = applyDemoBeat(baseline, AGENT_PLAN);
  const humanPlan = applyDemoBeat(agentPlan, HUMAN_DECISION);

  it("baseline keeps four of six promises", () => {
    const result = simulate(baseline);
    expect(result.totals.promisedTotal).toBe(6);
    expect(result.totals.promisesMet).toBe(BASELINE_EXPECTED_PROMISES);
    expect(result.totals.lateWorkItems).toEqual(["veh-03", "veh-05"]);
    expect(result.totals.constraintViolations).toEqual([]);
  });

  it("the agent plan keeps five of six", () => {
    const result = simulate(agentPlan);
    expect(result.totals.promisesMet).toBe(AGENT_PLAN.expectedPromisesMet);
    expect(result.totals.lateWorkItems).toEqual(["veh-03"]);
  });

  it("the human decision on top of the agent plan keeps all six", () => {
    const result = simulate(humanPlan);
    expect(result.totals.promisesMet).toBe(HUMAN_DECISION.expectedPromisesMet);
    expect(result.totals.lateWorkItems).toEqual([]);
    expect(result.totals.constraintViolations).toEqual([]);
  });

  it("the human decision alone is not enough", () => {
    const result = simulate(applyDemoBeat(baseline, HUMAN_DECISION));
    expect(result.totals.promisesMet).toBeLessThan(6);
  });

  it("names the blocked bay or the busiest technician as the bottleneck", () => {
    const result = simulate(baseline);
    expect(result.totals.bottleneck).not.toBeNull();
    expect(result.totals.bottleneck!.reason.length).toBeGreaterThan(10);
  });
});

describe("compareScenarios", () => {
  it("reports the promise delta and a verdict", () => {
    const base = workshopFixture();
    const candidate = applyDemoBeat(base, AGENT_PLAN);
    candidate.id = "SCN-AGENT";
    candidate.name = "Agent plan";
    const comparison = compareScenarios(base, candidate);
    expect(comparison.deltas.promisesMet).toBe(1);
    expect(comparison.verdict).toContain("Agent plan keeps 5 of 6");
  });
});
