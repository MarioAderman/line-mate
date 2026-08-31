import { describe, expect, it } from "vitest";
import { simulate } from "@/simulation";
import {
  AGENT_PLAN,
  HUMAN_DECISION,
  PART_DELAY,
  PlanSchema,
  STORY_STATES,
  applyDemoBeat,
  applyDisruption,
  calmFixture,
  canTransition,
  planFromBeat,
  validateScenario,
  workshopFixture,
} from "./index";

describe("calm → escalated", () => {
  it("the escalated baseline is exactly the calm shop plus the part delay", () => {
    const escalated = applyDisruption(calmFixture(), PART_DELAY);
    // Only the human-readable description differs between the two entry points.
    expect({ ...escalated, description: "" }).toEqual({ ...workshopFixture(), description: "" });
  });

  it("both fixtures validate", () => {
    expect(validateScenario(calmFixture())).toEqual([]);
    expect(validateScenario(workshopFixture())).toEqual([]);
  });

  it("the calm shop keeps every promise; the delay costs two", () => {
    expect(simulate(calmFixture()).totals.promisesMet).toBe(6);
    expect(simulate(workshopFixture()).totals.promisesMet).toBe(4);
  });

  it("applying the disruption never mutates its input", () => {
    const calm = calmFixture();
    applyDisruption(calm, PART_DELAY);
    expect(calm.resources.find((r) => r.id === "bay-3")!.status).toBe("idle");
  });
});

describe("plans", () => {
  it("demo beats are valid plans", () => {
    expect(PlanSchema.parse(planFromBeat(AGENT_PLAN)).changes).toHaveLength(7);
    expect(PlanSchema.parse(planFromBeat(HUMAN_DECISION)).changes).toHaveLength(2);
  });

  it("the story numbers still hold: 4/6 → 5/6 → 6/6", () => {
    const base = workshopFixture();
    const agent = applyDemoBeat(base, AGENT_PLAN);
    const human = applyDemoBeat(agent, HUMAN_DECISION);
    expect([base, agent, human].map((s) => simulate(s).totals.promisesMet)).toEqual([4, 5, 6]);
  });
});

describe("story states", () => {
  it("follow the scripted order and can restart", () => {
    expect(STORY_STATES).toEqual(["calm", "escalation", "running", "proposal", "resolved"]);
    expect(canTransition("calm", "escalation")).toBe(true);
    expect(canTransition("escalation", "running")).toBe(true);
    expect(canTransition("running", "proposal")).toBe(true);
    expect(canTransition("proposal", "resolved")).toBe(true);
    expect(canTransition("resolved", "calm")).toBe(true);
    expect(canTransition("calm", "resolved")).toBe(false);
  });
});
