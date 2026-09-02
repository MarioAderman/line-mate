import { describe, expect, it } from "vitest";
import { calmFixture, workshopFixture } from "@/domain";
import { simulate } from "@/simulation";
import {
  askAgentQuestion,
  countdown,
  inspectResource,
  inspectTechnician,
  inspectWorkItem,
} from "./inspect";

const OPEN = 14 * 60 + 15;
const escalated = workshopFixture();
const escalatedRun = simulate(escalated);
const calm = calmFixture();
const calmRun = simulate(calm);

describe("countdown", () => {
  it("counts minutes to the part and never goes negative", () => {
    expect(countdown(15 * 60, 15 * 60 + 30)).toBe("30 min");
    expect(countdown(15 * 60 + 29, 15 * 60 + 30)).toBe("1 min");
    expect(countdown(16 * 60, 15 * 60 + 30)).toBe("0 min");
  });

  it("switches to hours past the hour", () => {
    expect(countdown(14 * 60, 15 * 60 + 5)).toBe("1 h 05");
    expect(countdown(OPEN, 15 * 60 + 30)).toBe("1 h 15");
  });
});

describe("a car", () => {
  it("reads the promise margin off the run, not off a guess", () => {
    const sedan = inspectWorkItem(escalated, escalatedRun, OPEN, "veh-02")!;
    const outcome = escalatedRun.workItems.find((w) => w.workItemId === "veh-02")!;
    expect(sedan.promise.state).toBe("kept");
    expect(sedan.promise.dueLabel).toBe("16:00");
    expect(sedan.promise.detail).toBe(
      `${16 * 60 - outcome.completionMinute!} min margin`,
    );
  });

  it("says how late a missed promise is", () => {
    const suv = inspectWorkItem(escalated, escalatedRun, OPEN, "veh-03")!;
    expect(suv.promise.state).toBe("missed");
    expect(suv.promise.detail).toMatch(/(min late|does not finish today)/);
  });

  it("calls a walk-in a walk-in", () => {
    const minivan = inspectWorkItem(escalated, escalatedRun, OPEN, "veh-07")!;
    expect(minivan.promise).toMatchObject({ state: "none", dueLabel: null });
  });

  it("waits for the run before claiming an outcome", () => {
    const sedan = inspectWorkItem(escalated, null, OPEN, "veh-02")!;
    expect(sedan.promise.state).toBe("open");
    expect(sedan.promise.detail).toBe("not simulated yet");
  });

  it("walks the steps as the clock moves", () => {
    const segment = escalatedRun.segments
      .filter((s) => s.workItemId === "veh-02")
      .sort((a, b) => a.start - b.start)[0];

    const before = inspectWorkItem(escalated, escalatedRun, segment.start - 1, "veh-02")!;
    expect(before.steps[0].state).toBe("todo");

    const middle = segment.start + Math.floor((segment.end - segment.start) / 2);
    const during = inspectWorkItem(escalated, escalatedRun, middle, "veh-02")!;
    expect(during.steps[0].state).toBe("live");
    expect(during.steps[0].detail).toBe(`${middle - segment.start} / ${segment.end - segment.start}`);
    expect(during.steps[0].progress).toBeCloseTo(0.5, 1);

    const after = inspectWorkItem(escalated, escalatedRun, segment.end, "veh-02")!;
    expect(after.steps[0].state).toBe("done");
    expect(after.steps[0].progress).toBe(1);
  });

  it("names the part that is holding it, with the countdown", () => {
    const van = inspectWorkItem(escalated, escalatedRun, OPEN, "veh-12")!;
    expect(van.parts.waiting).toBe(true);
    expect(van.parts.label).toBe("Water pump · eta 15:30 · 1 h 15");
    expect(van.parts.etaMinute).toBe(15 * 60 + 30);
  });

  it("says on hand once the part has landed", () => {
    const van = inspectWorkItem(escalated, escalatedRun, 15 * 60 + 30, "veh-12")!;
    expect(van.parts).toMatchObject({ waiting: false, label: "on hand", etaMinute: null });
  });

  it("carries the route and the hand that will do the work", () => {
    const wagon = inspectWorkItem(calm, calmRun, OPEN, "veh-05")!;
    expect(wagon.route).toBe("Bay 3");
    expect(wagon.technician?.skills ?? []).toContain("suspension");
    expect(wagon.technician?.initial).toHaveLength(1);
  });

  it("offers no hand for a job the shift never starts", () => {
    // The wagon is the job the part delay strands: no segment, so no
    // technician to name. Inventing one would be a lie on the sheet.
    expect(escalatedRun.totals.unfinishedWorkItems).toContain("veh-05");
    expect(inspectWorkItem(escalated, escalatedRun, OPEN, "veh-05")!.technician).toBeNull();
  });

  it("returns nothing for an id the shop does not have", () => {
    expect(inspectWorkItem(escalated, escalatedRun, OPEN, "veh-99")).toBeNull();
  });
});

describe("a station", () => {
  it("counts down to the part while the bay is blocked", () => {
    const bay3 = inspectResource(escalated, escalatedRun, OPEN, "bay-3")!;
    expect(bay3.status).toBe("blocked");
    expect(bay3.statusLabel).toBe("Blocked until 15:30");
    expect(bay3.parts.label).toContain("1 h 15");
    // Half an hour later the same fact reads as half an hour less.
    expect(inspectResource(escalated, escalatedRun, 15 * 60, "bay-3")!.parts.label).toContain(
      "30 min",
    );
  });

  it("stops being blocked once the part lands", () => {
    const bay3 = inspectResource(escalated, escalatedRun, 15 * 60 + 31, "bay-3")!;
    expect(bay3.status).not.toBe("blocked");
    expect(bay3.parts.waiting).toBe(false);
  });

  it("shows the live job with measured progress and the next three", () => {
    const segment = calmRun.segments
      .filter((s) => s.resourceId === "bay-1")
      .sort((a, b) => a.start - b.start)[0];
    const middle = segment.start + Math.floor((segment.end - segment.start) / 2);
    const bay1 = inspectResource(calm, calmRun, middle, "bay-1")!;

    expect(bay1.current?.workItemId).toBe(segment.workItemId);
    expect(bay1.current?.progress).toBeCloseTo(0.5, 1);
    expect(bay1.current?.endsAt).toBe(
      `${String(Math.floor(segment.end / 60)).padStart(2, "0")}:${String(segment.end % 60).padStart(2, "0")}`,
    );
    expect(bay1.next.length).toBeLessThanOrEqual(3);
    // Never repeats the job that is already on the lift.
    expect(bay1.next.map((j) => j.workItemId)).not.toContain(segment.workItemId);
  });

  it("falls back to the pinned queue before the first run", () => {
    const bay3 = inspectResource(escalated, null, OPEN, "bay-3")!;
    expect(bay3.utilization).toBeNull();
    expect(bay3.next.map((j) => j.workItemId).sort()).toEqual(["veh-05", "veh-12"]);
    expect(bay3.next.every((j) => j.startsAt === "queued")).toBe(true);
  });

  it("reports utilisation as the run measured it", () => {
    const stat = calmRun.resources.find((r) => r.resourceId === "bay-1")!;
    expect(inspectResource(calm, calmRun, OPEN, "bay-1")!.utilization).toBe(stat.utilization);
  });
});

describe("a technician", () => {
  it("says where they are and what they can do", () => {
    const segment = calmRun.segments
      .filter((s) => s.technicianId === "tech-carlos")
      .sort((a, b) => a.start - b.start)[0];
    const during = inspectTechnician(calm, calmRun, segment.start, "tech-carlos")!;
    expect(during.where).toContain("ends");
    expect(during.skills).toEqual(["brakes", "suspension"]);
    expect(during.jobsToday).toBe(
      calmRun.technicians.find((t) => t.technicianId === "tech-carlos")!.jobs,
    );
  });

  it("says so when they are between jobs", () => {
    expect(inspectTechnician(calm, calmRun, 18 * 60, "tech-ana")!.where).toBe("between jobs");
  });
});

describe("ask agent", () => {
  it("writes a question carrying the facts on screen", () => {
    const van = inspectWorkItem(escalated, escalatedRun, OPEN, "veh-12")!;
    const question = askAgentQuestion(van, escalated, OPEN);
    expect(question).toContain("Line-Mate");
    expect(question).toContain("Brown van");
    expect(question).toContain("Water pump");
    expect(question).toContain("without overtime");
    // The question carries the live minute, not the shift opening.
    expect(askAgentQuestion(van, escalated, 16 * 60 + 19)).toContain("now 16:19");
  });

  it("asks about a bay in terms of the promises", () => {
    const bay3 = inspectResource(escalated, escalatedRun, OPEN, "bay-3")!;
    const question = askAgentQuestion(bay3, escalated, OPEN);
    expect(question).toContain("Bay 3");
    expect(question).toContain("blocked until 15:30");
    expect(question).toContain("six promises");
  });

  it("asks about a technician in terms of the schedule", () => {
    const carlos = inspectTechnician(escalated, escalatedRun, OPEN, "tech-carlos")!;
    expect(askAgentQuestion(carlos, escalated, OPEN)).toContain("brakes, suspension");
  });
});
