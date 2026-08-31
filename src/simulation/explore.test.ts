import { describe, expect, it } from "vitest";
import {
  AGENT_PLAN,
  HUMAN_DECISION,
  PlanSchema,
  applyDemoBeat,
  workshopFixture,
  type Scenario,
} from "@/domain";
import { simulate } from "./engine";
import { jitter, jitterBy, mixSeed, mulberry32 } from "./random";
import {
  DEFAULT_REPLICATIONS,
  DEFAULT_SEED,
  MAX_REPLICATIONS,
  PROGRESS_ROWS,
  PART_ETA_JITTER_MINUTES,
  STEP_DURATION_JITTER,
  TOP_CANDIDATES,
  WALK_IN_ARRIVAL_JITTER_MINUTES,
  applyPlanChanges,
  describeExploration,
  exploreSchedules,
  exploreSchedulesChunked,
  exploreSchedulesSteps,
  generateCandidates,
  planFromCandidate,
  seededVariant,
  simulateReplicated,
} from "./explore";

const fixture = workshopFixture();

/** The demo's target outcome: the human decision on top of the agent plan. */
function demoWinner(): Scenario {
  return applyDemoBeat(applyDemoBeat(workshopFixture(), AGENT_PLAN), HUMAN_DECISION);
}

describe("mulberry32", () => {
  it("is uniform in [0, 1) and repeats exactly for one seed", () => {
    const draws = Array.from({ length: 500 }, mulberry32(DEFAULT_SEED));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThan(1);
    expect(Array.from({ length: 500 }, mulberry32(DEFAULT_SEED))).toEqual(draws);
  });

  it("gives different seeds different streams", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
    expect(mixSeed(DEFAULT_SEED, 3)).not.toBe(mixSeed(DEFAULT_SEED, 4));
  });
});

describe("jitter helpers", () => {
  it("keeps a multiplicative jitter inside the band, as whole minutes", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 400; i += 1) {
      const value = jitter(rng, 90, 0.1);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(81);
      expect(value).toBeLessThanOrEqual(99);
    }
  });

  it("never returns a duration below the floor", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i += 1) expect(jitter(rng, 1, 0.9)).toBeGreaterThanOrEqual(1);
  });

  it("keeps an additive jitter inside the spread", () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 400; i += 1) {
      const value = jitterBy(rng, 930, 15);
      expect(value).toBeGreaterThanOrEqual(915);
      expect(value).toBeLessThanOrEqual(945);
    }
  });
});

describe("seeded worlds", () => {
  it("uses the scenario itself as world 0, so one run is always exact", () => {
    expect(seededVariant(fixture, DEFAULT_SEED, 0)).toBe(fixture);
  });

  it("wobbles durations, the part ETA and walk-ins inside their tolerances", () => {
    for (let k = 1; k <= 40; k += 1) {
      const world = seededVariant(fixture, DEFAULT_SEED, k);
      for (const item of world.workItems) {
        const source = fixture.workItems.find((w) => w.id === item.id)!;
        item.steps.forEach((step, index) => {
          const nominal = source.steps[index].durationMinutes;
          const band = Math.ceil(nominal * STEP_DURATION_JITTER);
          expect(Math.abs(step.durationMinutes - nominal)).toBeLessThanOrEqual(band);
        });
        // A promised customer arrives when they said they would; walk-ins drift.
        if (source.dueMinute !== null) {
          expect(item.arrivalMinute).toBe(source.arrivalMinute);
        } else {
          expect(Math.abs(item.arrivalMinute - source.arrivalMinute)).toBeLessThanOrEqual(
            WALK_IN_ARRIVAL_JITTER_MINUTES,
          );
        }
        expect(item.dueMinute).toBe(source.dueMinute);
        expect(item.priority).toBe(source.priority);
      }
      const bay3 = world.resources.find((r) => r.id === "bay-3")!;
      expect(Math.abs(bay3.blockedUntilMinute! - 930)).toBeLessThanOrEqual(PART_ETA_JITTER_MINUTES);
    }
  });

  it("never mutates the scenario it was given", () => {
    const before = JSON.stringify(fixture);
    for (let k = 0; k < 10; k += 1) simulate(seededVariant(fixture, DEFAULT_SEED, k));
    expect(JSON.stringify(fixture)).toBe(before);
  });
});

describe("simulateReplicated", () => {
  it("is deterministic for one seed and different for another", () => {
    const a = simulateReplicated(fixture, { seed: 42, replications: 12 });
    const b = simulateReplicated(fixture, { seed: 42, replications: 12 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = simulateReplicated(fixture, { seed: 43, replications: 12 });
    expect(c.meanPromisesMet).not.toBe(Number.NaN);
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });

  it("runs the number of worlds it was asked for, and says how many it ran", () => {
    for (const replications of [1, 37, 400]) {
      const result = simulateReplicated(fixture, { replications });
      expect(result.replications).toBe(replications);
    }
    // Above the guard rail it clamps, but never silently: the result says so.
    const clamped = simulateReplicated(fixture, { replications: MAX_REPLICATIONS + 1 });
    expect(clamped.replications).toBe(MAX_REPLICATIONS);
  });

  it("reports the nominal run alongside the spread", () => {
    const result = simulateReplicated(fixture, { replications: 8 });
    expect(result.nominal.totals.promisesMet).toBe(simulate(fixture).totals.promisesMet);
    expect(result.replications).toBe(8);
    expect(result.promisesMetRate).toBeGreaterThanOrEqual(0);
    expect(result.promisesMetRate).toBeLessThanOrEqual(1);
    expect(result.worstPromisesMet).toBeLessThanOrEqual(result.bestPromisesMet);
  });

  it("shows the escalated shop is reliably short of its promises", () => {
    const result = simulateReplicated(fixture, { replications: 40 });
    expect(result.nominal.totals.promisesMet).toBe(4);
    expect(result.bestPromisesMet).toBeLessThan(6);
  });
});

describe("candidate generation", () => {
  it("is bounded, uniquely identified and free of duplicate change sets", () => {
    const specs = generateCandidates(fixture);
    expect(specs.length).toBeGreaterThan(20);
    expect(specs.length).toBeLessThanOrEqual(300);
    expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
    expect(new Set(specs.map((s) => JSON.stringify(s.changes))).size).toBe(specs.length);
    expect(specs[0].changes).toEqual([]);
  });

  it("honours a tighter budget", () => {
    expect(generateCandidates(fixture, 12)).toHaveLength(12);
  });

  it("only pins jobs to bays that can run one of their steps", () => {
    for (const spec of generateCandidates(fixture)) {
      for (const change of spec.changes) {
        if (change.command !== "route_work_item" || change.resourceId === null) continue;
        const target = fixture.resources.find((r) => r.id === change.resourceId)!;
        const item = fixture.workItems.find((w) => w.id === change.workItemId)!;
        expect(item.steps.some((s) => s.requiredResourceType === target.type)).toBe(true);
      }
    }
  });

  it("moves the job squatting on the disrupted bay, promised or not", () => {
    const specs = generateCandidates(fixture);
    const routed = new Set(
      specs.flatMap((spec) =>
        spec.changes.filter((c) => c.command === "route_work_item").map((c) => c.workItemId),
      ),
    );
    // veh-12 carries no promise, so only the occupant rule can reach it — and
    // without reaching it the blocked bay is never really free.
    expect(routed).toContain("veh-12");
    expect(fixture.workItems.find((w) => w.id === "veh-12")!.dueMinute).toBeNull();
    expect(specs.map((s) => s.label)).toContain("Brown van off Bay 3");

    // A job pinned to a healthy bay is left alone by the occupant rule.
    const healthy = fixture.workItems.filter(
      (w) =>
        w.dueMinute === null &&
        w.route.resourceId !== null &&
        fixture.resources.find((r) => r.id === w.route.resourceId)!.blockedUntilMinute === null,
    );
    for (const item of healthy) expect(routed).not.toContain(item.id);
  });

  it("composes the occupant release with the promised-job moves", () => {
    const specs = generateCandidates(fixture);
    const composite = specs.filter((spec) => {
      const routes = spec.changes.filter((c) => c.command === "route_work_item");
      return (
        routes.some((c) => c.workItemId === "veh-12") &&
        routes.some((c) => c.workItemId !== "veh-12")
      );
    });
    // Neither half reaches six promises alone, so both must be reachable together.
    expect(composite.length).toBeGreaterThan(0);
  });

  it("labels candidates the way a manager would say them out loud", () => {
    const labels = generateCandidates(fixture).map((s) => s.label);
    expect(labels).toContain("Keep the current schedule");
    expect(labels).toContain("Promised jobs before walk-ins");
    // The blocked bay carries the minute it frees, so the row explains itself.
    expect(labels).toContain("White SUV first into Bay 3 at 15:30");
  });
});

describe("exploreSchedules", () => {
  it("returns the same summary byte for byte for the same seed", () => {
    const a = exploreSchedules(fixture, { seed: 99, replications: 6 });
    const b = exploreSchedules(fixture, { seed: 99, replications: 6 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seed).toBe(99);
  });

  it("counts every run it claims and stays bounded", () => {
    const summary = exploreSchedules(fixture);
    expect(summary.replications).toBe(DEFAULT_REPLICATIONS);
    expect(summary.runsExecuted).toBe(summary.candidatesEvaluated * summary.replications);
    expect(summary.runsExecuted).toBeGreaterThan(500);
    expect(summary.top.length).toBeLessThanOrEqual(TOP_CANDIDATES);
    expect(summary.best).toEqual(summary.top[0]);
    expect(summary.scenarioId).toBe(fixture.id);
  });

  it("finds a plan that keeps all six promises, and applying it really does", () => {
    const summary = exploreSchedules(fixture);
    const best = summary.best!;
    expect(best.promisesMet).toBe(6);
    expect(best.promisedTotal).toBe(6);
    expect(best.constraintViolations).toEqual([]);
    // The claim is checked against the engine, not trusted from the search.
    expect(simulate(applyPlanChanges(fixture, best.changes)).totals.promisesMet).toBe(6);
    // ...and it is at least as good as the scripted human-on-agent outcome.
    expect(best.promisesMet).toBeGreaterThanOrEqual(
      simulate(demoWinner()).totals.promisesMet,
    );
  });

  it("recommends a plan that holds up, not one that got lucky once", () => {
    const summary = exploreSchedules(fixture);
    // A loose band, never an exact figure: the number on screen is whatever
    // the engine measured, and this only has to catch a regression.
    expect(summary.best!.promisesMetRate).toBeGreaterThan(0.85);
    // ...and it has to beat leaving the shift exactly as it is.
    const doNothing = simulateReplicated(fixture, { replications: summary.replications });
    expect(summary.best!.promisesMetRate).toBeGreaterThan(doNothing.promisesMetRate);
  });

  it("holds six promises in worlds it never saw during the search", () => {
    const best = exploreSchedules(fixture).best!;
    // Far more replications than the search used: no overfitting to 24 worlds.
    const held = simulateReplicated(applyPlanChanges(fixture, best.changes), {
      replications: 400,
    });
    // The count that was asked for is the count that ran — a clamp here would
    // quietly shrink the evidence behind every robustness claim we make.
    expect(held.replications).toBe(400);
    expect(held.nominal.totals.promisesMet).toBe(6);
    expect(held.promisesMetRate).toBeGreaterThan(0.85);
    expect(held.worstPromisesMet).toBe(6);
  });

  it("ranks deterministically, ties broken by id", () => {
    const top = exploreSchedules(fixture).top;
    for (let i = 1; i < top.length; i += 1) {
      const a = top[i - 1];
      const b = top[i];
      expect(a.promisesMet).toBeGreaterThanOrEqual(b.promisesMet);
      if (a.promisesMet === b.promisesMet && a.promisesMetRate === b.promisesMetRate) {
        expect(a.completed >= b.completed || a.id < b.id).toBe(true);
      }
    }
  });

  it("leaves the scenario it explored untouched", () => {
    const before = JSON.stringify(fixture);
    exploreSchedules(fixture);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("hands the best candidate over as a plan apply_plan accepts", () => {
    const plan = planFromCandidate(exploreSchedules(fixture).best!);
    expect(() => PlanSchema.parse(plan)).not.toThrow();
  });

  it("describes itself in one line without inventing numbers", () => {
    const summary = exploreSchedules(fixture);
    const line = describeExploration(summary);
    expect(line).toContain(`Explored ${summary.candidatesEvaluated} schedules`);
    expect(line).toContain(`${summary.runsExecuted} runs`);
    expect(line).toContain(`best ${summary.best!.promisesMet}/${summary.best!.promisedTotal}`);
    expect(line).toContain(`${Math.round(summary.best!.promisesMetRate * 100)} % of runs`);
  });

  it("stays well inside the interaction budget", () => {
    const started = performance.now();
    exploreSchedules(fixture);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("progress", () => {
  it("streams chunks and ends on the same summary as the one-shot call", () => {
    const seen: number[] = [];
    const summary = exploreSchedulesChunked(fixture, {
      replications: 6,
      chunkSize: 4,
      onProgress: (progress) => {
        seen.push(progress.runsExecuted);
        expect(progress.rows.length).toBeLessThanOrEqual(8);
        expect(progress.runsExecuted).toBeLessThanOrEqual(progress.runsPlanned);
        for (const row of progress.rows) {
          expect(row.progress).toBeGreaterThanOrEqual(0);
          expect(row.progress).toBeLessThanOrEqual(1);
        }
      },
    });
    expect(seen.length).toBeGreaterThan(1);
    // Monotonic, and the last emission accounts for every planned run.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(seen[seen.length - 1]).toBe(summary.runsExecuted);
    expect(JSON.stringify(summary)).toBe(
      JSON.stringify(exploreSchedules(fixture, { replications: 6 })),
    );
  });

  it("is drivable a chunk at a time, so the UI can animate a real search", () => {
    const steps = exploreSchedulesSteps(fixture, { replications: 4, chunkSize: 8 });
    const statuses: string[] = [];
    let last: ReturnType<typeof exploreSchedules> | null = null;
    for (;;) {
      const step = steps.next();
      if (step.done) {
        last = step.value;
        break;
      }
      statuses.push(step.value.status);
    }
    expect(statuses.length).toBeGreaterThan(1);
    // Every chunk but the last says "running"; the last one closes the panel.
    expect(statuses[statuses.length - 1]).toBe("done");
    expect(statuses.slice(0, -1).every((s) => s === "running")).toBe(true);
    expect(last!.best!.promisesMet).toBe(6);
  });

  it("fills the panel even when a chunk is larger than the row window", () => {
    for (const chunkSize of [1, 4, PROGRESS_ROWS, PROGRESS_ROWS * 2, 40]) {
      let emissions = 0;
      exploreSchedulesChunked(fixture, {
        replications: 2,
        chunkSize,
        onProgress: (progress) => {
          emissions += 1;
          expect(progress.rows.length).toBeGreaterThan(0);
          expect(progress.rows.length).toBeLessThanOrEqual(PROGRESS_ROWS);
          // Rows are a contiguous slice of the search, newest work last.
          expect(new Set(progress.rows.map((r) => r.id)).size).toBe(progress.rows.length);
        },
      });
      expect(emissions).toBeGreaterThan(0);
    }
  });

  it("reports a best-so-far from the first chunk onwards", () => {
    const bests: (string | null)[] = [];
    exploreSchedulesChunked(fixture, {
      replications: 4,
      chunkSize: 6,
      onProgress: (progress) => bests.push(progress.best?.id ?? null),
    });
    expect(bests.every((id) => id !== null)).toBe(true);
  });
});
