/**
 * Scenario exploration: hundreds of real, seeded shift simulations.
 *
 * Beat 3 of the demo ("Run scenarios and make sure we keep all six") is not a
 * progress-bar prop. `exploreSchedules` enumerates a bounded, deterministic
 * set of schedule alternatives — promised jobs first, bay pins, queue
 * positions, released pins, and whoever is squatting on the blocked bay — and
 * evaluates each one against the same seeded worlds. Every figure the UI and
 * the agent quote ("6/6 in N % of runs") is measured here, never asserted:
 * nothing in this module hardcodes an outcome.
 *
 * Pure TypeScript: no React, no store, no clock, no `Math.random`.
 *
 * Method
 *   1. Build `replications` worlds from the seed. World 0 is the nominal one
 *      (no jitter); worlds 1..n-1 wobble step durations, the blocked bay's
 *      part ETA and walk-in arrival times within operational tolerances.
 *   2. Generate candidate schedules (see `generateCandidates`).
 *   3. Score every candidate against *the same* worlds (common random
 *      numbers), so two candidates never differ because they got lucky.
 *   4. Rank on the nominal run, break ties on robustness then id, and return
 *      a bounded summary.
 */
import {
  formatMinute,
  type ExplorationCandidate,
  type ExplorationProgress,
  type ExplorationRow,
  type ExplorationSummary,
  type Plan,
  type PlanChange,
  type Resource,
  type Scenario,
  type WorkItem,
} from "@/domain";
import { simulate } from "./engine";
import type { SimulationResult } from "./types";
import { jitter, jitterBy, mixSeed, mulberry32 } from "./random";

/** Frozen so the demo reproduces exactly without anyone passing a seed. */
export const DEFAULT_SEED = 20260829;
export const DEFAULT_REPLICATIONS = 24;
export const DEFAULT_MAX_CANDIDATES = 300;
/** Bound on the tool response: the agent gets a shortlist, not the search. */
export const TOP_CANDIDATES = 8;
/** Candidates evaluated between two progress emissions. */
export const DEFAULT_CHUNK_SIZE = 4;
/** Rows a progress emission carries — a sliding window, not the whole list. */
export const PROGRESS_ROWS = 8;

/**
 * Operational tolerances the jitter stays inside.
 *
 * The two spreads are deliberately different sizes. Wrenching time is the
 * real unknown on a shop floor — an estimate is an estimate, so step
 * durations move ±10 %. The 15:30 part ETA is not a guess: it is a delivery
 * window the supplier confirmed *after* the miss, so its variance is tight.
 * Walk-ins, who promised nothing, drift by ±10 minutes.
 */
export const STEP_DURATION_JITTER = 0.1;
export const PART_ETA_JITTER_MINUTES = 5;
export const WALK_IN_ARRIVAL_JITTER_MINUTES = 10;

export interface ReplicationOptions {
  seed?: number;
  replications?: number;
}

export interface ExploreOptions extends ReplicationOptions {
  maxCandidates?: number;
  chunkSize?: number;
}

/** Aggregate of one candidate across the seeded worlds. */
export interface ReplicatedResult {
  scenarioId: string;
  seed: number;
  replications: number;
  /** World 0: the unjittered run, and the numbers the UI shows as "the plan". */
  nominal: SimulationResult;
  promisedTotal: number;
  /** Share of worlds in which every promise was kept (0..1). */
  promisesMetRate: number;
  meanPromisesMet: number;
  meanCompleted: number;
  worstPromisesMet: number;
  bestPromisesMet: number;
  /** Union across worlds, de-duplicated. */
  constraintViolations: string[];
}

/* ------------------------------------------------------------- utilities */

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Applies plan changes without validation or a deep clone: the command layer
 * is the validated path, and exploration runs this thousands of times.
 */
export function applyPlanChanges(scenario: Scenario, changes: PlanChange[]): Scenario {
  if (changes.length === 0) return scenario;
  const patched = new Map<string, WorkItem>();
  for (const change of changes) {
    const current =
      patched.get(change.workItemId) ??
      scenario.workItems.find((w) => w.id === change.workItemId);
    if (!current) continue;
    patched.set(
      change.workItemId,
      change.command === "update_work_item"
        ? { ...current, priority: change.priority }
        : { ...current, route: { resourceId: change.resourceId, position: change.position } },
    );
  }
  if (patched.size === 0) return scenario;
  return {
    ...scenario,
    workItems: scenario.workItems.map((w) => patched.get(w.id) ?? w),
  };
}

/**
 * World `replication` of `scenario`. Replication 0 is the scenario itself so
 * every exploration contains one exact, explainable run.
 */
export function seededVariant(scenario: Scenario, seed: number, replication: number): Scenario {
  if (replication === 0) return scenario;
  const rng = mulberry32(mixSeed(seed, replication));
  const startMinute = scenario.clock.startMinute;
  return {
    ...scenario,
    resources: scenario.resources.map((resource) =>
      resource.blockedUntilMinute === null
        ? resource
        : {
            ...resource,
            blockedUntilMinute: jitterBy(
              rng,
              resource.blockedUntilMinute,
              PART_ETA_JITTER_MINUTES,
              startMinute,
            ),
          },
    ),
    workItems: scenario.workItems.map((item) => ({
      ...item,
      // Promised customers show up when they said they would; walk-ins drift.
      arrivalMinute:
        item.dueMinute === null
          ? jitterBy(rng, item.arrivalMinute, WALK_IN_ARRIVAL_JITTER_MINUTES)
          : item.arrivalMinute,
      steps: item.steps.map((step) => ({
        ...step,
        durationMinutes: jitter(rng, step.durationMinutes, STEP_DURATION_JITTER),
      })),
    })),
  };
}

function buildWorlds(scenario: Scenario, seed: number, replications: number): Scenario[] {
  const worlds: Scenario[] = [];
  for (let k = 0; k < replications; k += 1) worlds.push(seededVariant(scenario, seed, k));
  return worlds;
}

function aggregate(
  scenario: Scenario,
  seed: number,
  runs: SimulationResult[],
): ReplicatedResult {
  const nominal = runs[0];
  const promisedTotal = nominal.totals.promisedTotal;
  const met = runs.map((r) => r.totals.promisesMet);
  const violations = new Set<string>();
  for (const run of runs) for (const v of run.totals.constraintViolations) violations.add(v);
  const kept = met.filter((m) => m >= promisedTotal).length;
  const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
  return {
    scenarioId: scenario.id,
    seed,
    replications: runs.length,
    nominal,
    promisedTotal,
    promisesMetRate: promisedTotal === 0 ? 1 : round(kept / runs.length),
    meanPromisesMet: round(sum(met) / runs.length, 2),
    meanCompleted: round(sum(runs.map((r) => r.totals.completed)) / runs.length, 2),
    worstPromisesMet: Math.min(...met),
    bestPromisesMet: Math.max(...met),
    constraintViolations: [...violations].sort(),
  };
}

/**
 * Runs one scenario across seeded worlds. The engine stays deterministic;
 * the variability is in the worlds, not in the run.
 */
export function simulateReplicated(
  scenario: Scenario,
  options: ReplicationOptions = {},
): ReplicatedResult {
  const seed = clampInt(options.seed, DEFAULT_SEED, 0, 0xffffffff);
  const replications = clampInt(options.replications, DEFAULT_REPLICATIONS, 1, 200);
  const runs = buildWorlds(scenario, seed, replications).map(simulate);
  return aggregate(scenario, seed, runs);
}

/* --------------------------------------------------------- candidates */

/** A candidate before it has been scored: an id, a sentence, and the changes. */
export interface CandidateSpec {
  id: string;
  label: string;
  changes: PlanChange[];
}

const POSITION_WORDS: Record<number, string> = { 1: "first", 2: "second" };
/** Queue positions the search is allowed to try (brief: 1 and 2). */
export const CANDIDATE_POSITIONS = [1, 2] as const;

function promisedJobs(scenario: Scenario): WorkItem[] {
  return scenario.workItems
    .filter((w) => w.dueMinute !== null)
    .sort((a, b) => a.dueMinute! - b.dueMinute! || byId(a.id, b.id));
}

function bays(scenario: Scenario): Resource[] {
  return scenario.resources.filter((r) => r.type === "bay").sort((a, b) => byId(a.id, b.id));
}

function describePin(item: WorkItem, bay: Resource, position: number): string {
  const when =
    bay.blockedUntilMinute !== null ? ` at ${formatMinute(bay.blockedUntilMinute)}` : "";
  return `${item.vehicle} ${POSITION_WORDS[position] ?? `position ${position}`} into ${bay.name}${when}`;
}

function changeKey(changes: PlanChange[]): string {
  return changes
    .map((c) =>
      c.command === "update_work_item"
        ? `p:${c.workItemId}:${c.priority}`
        : `r:${c.workItemId}:${c.resourceId ?? "-"}:${c.position ?? "-"}`,
    )
    .join("|");
}

/** A resource nobody can use yet: a part delay, a breakdown. */
function isDisrupted(resource: Resource): boolean {
  return (
    resource.blockedUntilMinute !== null ||
    resource.status === "blocked" ||
    resource.status === "down"
  );
}

interface RouteMove {
  item: WorkItem;
  resourceId: string | null;
  position: number | null;
  label: string;
}

/**
 * What to do with whoever is sitting on a disrupted resource.
 *
 * The job holding the blocked bay need not be a promised one — in the demo it
 * is a walk-in — but it decides whether the bay is actually free the moment
 * the part lands. Leave it pinned and it simply takes the bay back, starving
 * the promised job that was routed there. So the search has to be able to
 * roll it off the lift, or send it somewhere else.
 */
function occupantMoves(scenario: Scenario, alreadyOffered: Set<string>): RouteMove[] {
  const disrupted = scenario.resources.filter(isDisrupted).map((r) => r.id);
  const moves: RouteMove[] = [];
  for (const item of scenario.workItems) {
    if (item.route.resourceId === null) continue;
    if (!disrupted.includes(item.route.resourceId)) continue;
    if (alreadyOffered.has(item.id)) continue;
    const from = scenario.resources.find((r) => r.id === item.route.resourceId);
    moves.push({
      item,
      resourceId: null,
      position: null,
      label: `${item.vehicle} off ${from?.name ?? item.route.resourceId}`,
    });
    for (const bay of bays(scenario)) {
      if (bay.id === item.route.resourceId || isDisrupted(bay)) continue;
      if (!item.steps.some((s) => s.requiredResourceType === bay.type)) continue;
      for (const position of CANDIDATE_POSITIONS) {
        moves.push({
          item,
          resourceId: bay.id,
          position,
          label: describePin(item, bay, position),
        });
      }
    }
  }
  return moves;
}

function routeChange(move: RouteMove): PlanChange {
  return {
    command: "route_work_item",
    workItemId: move.item.id,
    resourceId: move.resourceId,
    position: move.position,
  };
}

/**
 * The search space, in a fixed order so ids are stable across runs:
 *
 *   0. the current schedule, untouched — the honest reference point;
 *   A. promised jobs raised to priority 1, combined with at most one released
 *      pin and at most one new pin (bay × queue position);
 *   B. each move available for the job occupying a disrupted resource;
 *   C. every move from A, with that occupant additionally rolled off.
 *
 * C is the composite the demo turns on: freeing the blocked bay only pays off
 * once the job squatting on it has somewhere else to go, and neither half
 * reaches six promises alone. Every candidate is still a plan a human could
 * describe in one sentence, which is what makes the proposal explainable.
 */
export function generateCandidates(
  scenario: Scenario,
  maxCandidates: number = DEFAULT_MAX_CANDIDATES,
): CandidateSpec[] {
  const promised = promisedJobs(scenario);
  const priorityChanges: PlanChange[] = promised
    .filter((item) => item.priority !== 1)
    .map((item) => ({ command: "update_work_item", workItemId: item.id, priority: 1 }));

  const releases: (WorkItem | null)[] = [
    null,
    ...promised.filter((item) => item.route.resourceId !== null),
  ];
  const pins: ({ item: WorkItem; bay: Resource; position: number } | null)[] = [null];
  for (const item of promised) {
    for (const bay of bays(scenario)) {
      // Same rule as route_work_item: the target must run one of the steps.
      if (!item.steps.some((s) => s.requiredResourceType === bay.type)) continue;
      for (const position of CANDIDATE_POSITIONS) pins.push({ item, bay, position });
    }
  }
  const occupants = occupantMoves(scenario, new Set(promised.map((w) => w.id)));
  const occupantRelease = occupants.find((m) => m.resourceId === null) ?? null;

  const specs: CandidateSpec[] = [];
  const seen = new Set<string>();
  const push = (label: string, changes: PlanChange[]) => {
    if (specs.length >= maxCandidates) return;
    const key = changeKey(changes);
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({ id: `CND-${String(specs.length).padStart(3, "0")}`, label, changes });
  };

  push("Keep the current schedule", []);

  const promisedMoves = (withOccupant: RouteMove | null) => {
    for (const release of releases) {
      for (const pin of pins) {
        // Releasing a pin only to re-pin the same job is the pin candidate.
        if (release && pin && release.id === pin.item.id) continue;
        const changes = [...priorityChanges];
        const parts: string[] = [];
        if (release) {
          const bay = scenario.resources.find((r) => r.id === release.route.resourceId);
          changes.push({
            command: "route_work_item",
            workItemId: release.id,
            resourceId: null,
            position: null,
          });
          parts.push(`${release.vehicle} off ${bay?.name ?? release.route.resourceId}`);
        }
        if (pin) {
          changes.push({
            command: "route_work_item",
            workItemId: pin.item.id,
            resourceId: pin.bay.id,
            position: pin.position,
          });
          parts.push(describePin(pin.item, pin.bay, pin.position));
        }
        if (withOccupant) {
          changes.push(routeChange(withOccupant));
          parts.push(withOccupant.label);
        }
        push(parts.length > 0 ? parts.join(" · ") : "Promised jobs before walk-ins", changes);
      }
    }
  };

  promisedMoves(null);
  for (const move of occupants) push(move.label, [...priorityChanges, routeChange(move)]);
  if (occupantRelease) promisedMoves(occupantRelease);

  return specs;
}

/** The best candidate as a plan `apply_plan` can execute. */
export function planFromCandidate(candidate: ExplorationCandidate): Plan {
  return { id: `PLAN-${candidate.id}`, label: candidate.label, changes: candidate.changes };
}

/* ---------------------------------------------------------- evaluation */

function evaluate(spec: CandidateSpec, worlds: Scenario[], seed: number): ExplorationCandidate {
  const runs = worlds.map((world) => simulate(applyPlanChanges(world, spec.changes)));
  const stats = aggregate(worlds[0], seed, runs);
  return {
    id: spec.id,
    label: spec.label,
    changes: spec.changes,
    promisesMetRate: stats.promisesMetRate,
    promisesMet: stats.nominal.totals.promisesMet,
    promisedTotal: stats.promisedTotal,
    completed: stats.nominal.totals.completed,
    constraintViolations: stats.constraintViolations,
  };
}

/**
 * The nominal run decides, robustness breaks the tie.
 *
 * The winning plan is the one the human applies, and the board then renders
 * its *deterministic* run — so a candidate that only reaches six promises in
 * jittered worlds would put a number on screen the applied schedule does not
 * produce. Among plans that keep the same promises nominally, the one that
 * survives the most seeded worlds wins. Every tie ends at the candidate id,
 * so the ranking is byte-stable.
 */
export function rankCandidates(a: ExplorationCandidate, b: ExplorationCandidate): number {
  return (
    b.promisesMet - a.promisesMet ||
    b.promisesMetRate - a.promisesMetRate ||
    b.completed - a.completed ||
    a.constraintViolations.length - b.constraintViolations.length ||
    a.changes.length - b.changes.length ||
    byId(a.id, b.id)
  );
}

function rowFor(spec: CandidateSpec, done: ExplorationCandidate | undefined): ExplorationRow {
  return {
    id: spec.id,
    label: spec.label,
    progress: done ? 1 : 0,
    promisesMet: done ? done.promisesMet : null,
    promisesMetRate: done ? done.promisesMetRate : null,
  };
}

/**
 * The iterator form: yields an `ExplorationProgress` every `chunkSize`
 * candidates and returns the summary. The UI drives it a chunk per frame so
 * the scenarios panel animates while the numbers are actually being computed.
 */
export function* exploreSchedulesSteps(
  scenario: Scenario,
  options: ExploreOptions = {},
): Generator<ExplorationProgress, ExplorationSummary, void> {
  const seed = clampInt(options.seed, DEFAULT_SEED, 0, 0xffffffff);
  const replications = clampInt(options.replications, DEFAULT_REPLICATIONS, 1, 200);
  const maxCandidates = clampInt(options.maxCandidates, DEFAULT_MAX_CANDIDATES, 1, 2000);
  const chunkSize = clampInt(options.chunkSize, DEFAULT_CHUNK_SIZE, 1, 64);

  const worlds = buildWorlds(scenario, seed, replications);
  const specs = generateCandidates(scenario, maxCandidates);
  const runsPlanned = specs.length * replications;

  const evaluated: ExplorationCandidate[] = [];
  const byIndex = new Map<number, ExplorationCandidate>();
  let best: ExplorationCandidate | null = null;

  const rowsUpTo = (upTo: number): ExplorationRow[] => {
    const start = Math.max(0, upTo - (PROGRESS_ROWS - chunkSize));
    return specs
      .slice(start, Math.min(specs.length, start + PROGRESS_ROWS))
      .map((spec, offset) => rowFor(spec, byIndex.get(start + offset)));
  };

  for (let index = 0; index < specs.length; index += 1) {
    const candidate = evaluate(specs[index], worlds, seed);
    evaluated.push(candidate);
    byIndex.set(index, candidate);
    if (!best || rankCandidates(candidate, best) < 0) best = candidate;

    const finished = index + 1;
    if (finished % chunkSize === 0 && finished < specs.length) {
      yield {
        status: "running",
        runsExecuted: finished * replications,
        runsPlanned,
        rows: rowsUpTo(finished),
        best,
      };
    }
  }

  const top = [...evaluated].sort(rankCandidates).slice(0, TOP_CANDIDATES);
  const summary: ExplorationSummary = {
    scenarioId: scenario.id,
    seed,
    replications,
    candidatesEvaluated: specs.length,
    runsExecuted: specs.length * replications,
    best: top[0] ?? null,
    top,
  };
  yield {
    status: "done",
    runsExecuted: summary.runsExecuted,
    runsPlanned,
    rows: rowsUpTo(specs.length),
    best: summary.best,
  };
  return summary;
}

/**
 * The chunked form: same search, driven to completion here, with
 * `onProgress` called every `chunkSize` candidates.
 */
export function exploreSchedulesChunked(
  scenario: Scenario,
  options: ExploreOptions & { onProgress?: (progress: ExplorationProgress) => void } = {},
): ExplorationSummary {
  const { onProgress, ...rest } = options;
  const steps = exploreSchedulesSteps(scenario, rest);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
    onProgress?.(step.value);
  }
}

/** The whole search in one call. Same seed in, byte-identical summary out. */
export function exploreSchedules(
  scenario: Scenario,
  options: ExploreOptions = {},
): ExplorationSummary {
  return exploreSchedulesChunked(scenario, options);
}

/** The one-line result the activity strip and the agent both quote. */
export function describeExploration(summary: ExplorationSummary): string {
  if (!summary.best) return `Explored ${summary.candidatesEvaluated} schedules · no candidate ran.`;
  const rate = Math.round(summary.best.promisesMetRate * 100);
  return (
    `Explored ${summary.candidatesEvaluated} schedules in ${summary.runsExecuted} runs · ` +
    `best ${summary.best.promisesMet}/${summary.best.promisedTotal} in ${rate} % of runs`
  );
}
