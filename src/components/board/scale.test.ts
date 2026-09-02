/**
 * The Board's time arithmetic. Every progress bar, countdown and queue number
 * on the sheet comes from these, so they are the part worth pinning down: a
 * caption that lies about the shift is worse than no caption at all.
 */
import { describe, expect, it } from "vitest";
import { workshopFixture } from "@/domain";
import { acceptsHover, beginDrag, canRoute, dropStateFor } from "./drag";
import {
  minutePercent,
  minutesElapsed,
  minutesUntil,
  progressLabel,
  queueOrder,
  ticks,
  windowPercent,
  windowProgress,
} from "./scale";

const CLOCK = workshopFixture().clock; // 14:15 -> 18:00
const at = (h: number, m = 0) => h * 60 + m;

describe("windowProgress", () => {
  it("runs 0 -> 1 across the window and clamps outside it", () => {
    expect(windowProgress(at(14, 15), at(15, 15), at(14, 0))).toBe(0);
    expect(windowProgress(at(14, 15), at(15, 15), at(14, 15))).toBe(0);
    expect(windowProgress(at(14, 15), at(15, 15), at(14, 45))).toBeCloseTo(0.5, 6);
    expect(windowProgress(at(14, 15), at(15, 15), at(16, 0))).toBe(1);
  });

  it("treats an empty window as finished once the clock reaches it", () => {
    expect(windowProgress(900, 900, 899)).toBe(0);
    expect(windowProgress(900, 900, 900)).toBe(1);
  });
});

describe("progressLabel", () => {
  it("counts up while there is a way to go", () => {
    // 14:15 + 26 of a 45-minute job.
    expect(progressLabel(at(14, 15), at(15, 0), at(14, 41))).toBe("26 / 45 min");
  });

  it("switches to a countdown in the last stretch", () => {
    expect(progressLabel(at(14, 15), at(14, 45), at(14, 41))).toBe("4 min left");
    expect(progressLabel(at(14, 15), at(14, 45), at(14, 40))).toBe("5 min left");
    expect(progressLabel(at(14, 15), at(14, 45), at(14, 39))).toBe("24 / 30 min");
  });

  it("says done once the window has closed, and never goes negative", () => {
    expect(progressLabel(at(14, 15), at(14, 45), at(14, 45))).toBe("done");
    expect(progressLabel(at(14, 15), at(14, 45), at(17, 0))).toBe("done");
  });
});

describe("minutesUntil / minutesElapsed", () => {
  it("counts down to the part and stops at zero", () => {
    expect(minutesUntil(at(15, 30), at(14, 41))).toBe(49);
    expect(minutesUntil(at(15, 30), at(15, 30))).toBe(0);
    expect(minutesUntil(at(15, 30), at(16, 0))).toBe(0);
  });

  it("clamps elapsed to the window at both ends", () => {
    expect(minutesElapsed(at(14, 15), at(15, 0), at(14, 0))).toBe(0);
    expect(minutesElapsed(at(14, 15), at(15, 0), at(14, 41))).toBe(26);
    expect(minutesElapsed(at(14, 15), at(15, 0), at(17, 0))).toBe(45);
  });
});

describe("queueOrder", () => {
  it("reads a bay's queue the way the commands do: position, priority, id", () => {
    const scenario = workshopFixture();
    const pick = (id: string) => scenario.workItems.find((w) => w.id === id)!;
    const pinned = { ...pick("veh-12"), route: { resourceId: "bay-3", position: 1 } };
    const loose = { ...pick("veh-05"), route: { resourceId: "bay-3", position: null } };
    const urgent = { ...pick("veh-02"), priority: 1, route: { resourceId: "bay-3", position: null } };

    expect(queueOrder([loose, urgent, pinned]).map((w) => w.id)).toEqual([
      "veh-12", // position 1 wins
      "veh-02", // then priority 1
      "veh-05",
    ]);
  });

  it("does not mutate the array it is given", () => {
    const scenario = workshopFixture();
    const items = scenario.workItems.slice(0, 3);
    const before = items.map((w) => w.id);
    queueOrder(items);
    expect(items.map((w) => w.id)).toEqual(before);
  });
});

describe("the shift scale itself", () => {
  it("puts 14:15 on the left edge and 18:00 on the right", () => {
    expect(minutePercent(CLOCK.startMinute, CLOCK)).toBe(0);
    expect(minutePercent(CLOCK.endMinute, CLOCK)).toBe(100);
    expect(minutePercent(at(16, 7), CLOCK)).toBeCloseTo(((at(16, 7) - 855) / 225) * 100, 6);
  });

  it("clips a window to the drawn shift", () => {
    expect(windowPercent(at(13, 0), at(14, 15), CLOCK)).toEqual({ left: 0, width: 0 });
    const full = windowPercent(CLOCK.startMinute, CLOCK.endMinute, CLOCK);
    expect(full).toEqual({ left: 0, width: 100 });
  });

  it("ticks every quarter hour from the opening minute to close", () => {
    const marks = ticks(CLOCK, 15);
    expect(marks[0]).toBe(CLOCK.startMinute);
    expect(marks[marks.length - 1]).toBe(CLOCK.endMinute);
    expect(new Set(marks.map((m) => m % 15)).has(0)).toBe(true);
  });
});

/* --------------------------------------------------------------- dragging */

/** A DataTransfer stand-in: only `types` is readable during `dragover`. */
const types = (list: string[]) => ({ types: list }) as unknown as DataTransfer;
const WORK_ITEM = "application/x-workshop-work-item";

describe("what a lane does with a job in the air", () => {
  const scenario = workshopFixture();

  it("lights the bays that can run the job and steps the rest back", () => {
    // Brake pads need a bay; the diagnostics station cannot take them.
    const drag = beginDrag(scenario, "veh-02", "bay-1");
    expect(drag.eligible).toEqual(["bay-1", "bay-2", "bay-3"]);
    expect(dropStateFor(drag, "bay-1")).toBe("source");
    expect(dropStateFor(drag, "bay-2")).toBe("eligible");
    expect(dropStateFor(drag, "diag-1")).toBe("ineligible");
    expect(dropStateFor(null, "bay-2")).toBe("none");
  });

  it("keeps a job that needs the station eligible for the station", () => {
    // The white SUV is diagnosed first, then repaired: both can take it.
    const drag = beginDrag(scenario, "veh-03", null);
    expect(drag.eligible).toContain("diag-1");
    expect(drag.eligible).toContain("bay-3");
  });

  it("welcomes a drag it cannot inspect and refuses anything that is not a job", () => {
    // A proposal card dragged in from another stream: `dragover` sees the type
    // but never the payload, so the lane must let it hover.
    expect(acceptsHover(null, "diag-1", types([WORK_ITEM]))).toBe(true);
    expect(acceptsHover(null, "diag-1", types(["text/plain"]))).toBe(false);
    expect(acceptsHover(null, "diag-1", null)).toBe(false);
  });

  it("refuses the hover only when it knows the lane cannot run the job", () => {
    const drag = beginDrag(scenario, "veh-02", "bay-1");
    expect(acceptsHover(drag, "bay-2", types([WORK_ITEM]))).toBe(true);
    expect(acceptsHover(drag, "diag-1", types([WORK_ITEM]))).toBe(false);
  });

  it("judges the drop itself by the payload, wherever the drag began", () => {
    expect(canRoute(scenario, "veh-02", "bay-3")).toBe(true);
    expect(canRoute(scenario, "veh-02", "diag-1")).toBe(false);
    expect(canRoute(scenario, "nope", "bay-1")).toBe(false);
  });
});
