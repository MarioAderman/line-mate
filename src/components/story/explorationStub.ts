/**
 * ============================================================================
 * TODO(engine) — TEMPORARY. Replaced wholesale at I1 by engine-explorer's
 * `exploreSchedulesSteps()` / `explore_schedules`. Nothing outside this file
 * knows it exists: `storySlice` depends on the `ExplorationRunner` type, and
 * the panels render whatever `ExplorationSummary` comes back.
 * ============================================================================
 *
 * What it is: a small, honest search. It declares a handful of candidate plans
 * built from the demo's own moves, runs the real deterministic engine over
 * every one of them, and reports what it measured. There is no scripted
 * winner, no hardcoded rate and no invented figure anywhere in this file — the
 * ranking is whatever the engine says.
 *
 * What a "run" is here: the shop's stated uncertainty is the supplier ETA
 * ("waiting for a water pump — supplier ETA 15:30"), so the stub replays each
 * candidate against a declared spread of ETAs and counts how many of those
 * worlds kept every promise. That is a real measurement over a declared,
 * visible assumption — it is NOT the seeded Monte Carlo the real engine does,
 * and the numbers it produces are smaller and blunter. It exists so the panels
 * can be built and recorded against the right shape.
 */
import {
  formatMinute,
  applyScheduleChange,
  type ExplorationCandidate,
  type ExplorationProgress,
  type ExplorationSummary,
  type Plan,
  type PlanChange,
  type Scenario,
} from "@/domain";
import { AGENT_PLAN } from "@/domain";
import { simulate } from "@/simulation";

/** Kept for contract parity with the real call; the stub is not stochastic. */
export const STORY_SEED = 20260829;
/** Milliseconds between progress ticks (~2 s over the whole search). */
export const STORY_TICK_MS = 45;

/** The supplier ETAs the stub replays each candidate against. */
export const ETA_SPREAD_MINUTES = [
  15 * 60 + 10,
  15 * 60 + 20,
  15 * 60 + 30,
  15 * 60 + 40,
  15 * 60 + 50,
  16 * 60,
  16 * 60 + 10,
  16 * 60 + 20,
];

const route = (
  workItemId: string,
  resourceId: string | null,
  position: number | null = null,
): PlanChange => ({ command: "route_work_item", workItemId, resourceId, position });

const PRIORITY_FIRST = AGENT_PLAN.changes.filter((c) => c.command === "update_work_item");
const WAGON_RELEASE = AGENT_PLAN.changes.filter((c) => c.command === "route_work_item");
const BASE = [...PRIORITY_FIRST, ...WAGON_RELEASE];

/**
 * The candidate plans, as data. Every move here is a schedule change the shop
 * could actually make: no overtime, no extra technician, nothing cancelled.
 */
export const STUB_CANDIDATE_PLANS: Array<{ id: string; label: string; changes: PlanChange[] }> = [
  { id: "EXP-01", label: "Promised cars ahead of walk-ins", changes: [...PRIORITY_FIRST] },
  { id: "EXP-02", label: "Free the wagon from Bay 3", changes: [...BASE] },
  { id: "EXP-03", label: "SUV first into Bay 3", changes: [...BASE, route("veh-03", "bay-3", 1)] },
  { id: "EXP-04", label: "Van rolls off the lift", changes: [...BASE, route("veh-12", null)] },
  {
    id: "EXP-05",
    label: "SUV first, van rolls off",
    changes: [...BASE, route("veh-03", "bay-3", 1), route("veh-12", null)],
  },
  {
    id: "EXP-06",
    label: "Brakes together on Bay 2",
    changes: [...BASE, route("veh-02", "bay-2", 1), route("veh-06", "bay-2", 2)],
  },
];

/* ------------------------------------------------------------------ worlds */

/**
 * The scenario as it would be if the part landed at `minute`. Returns just the
 * scenario itself when nothing is blocked, so a calm world is one world.
 */
function worldWithPartEta(scenario: Scenario, minute: number): Scenario {
  const next = structuredClone(scenario);
  const blocked = next.resources.find((r) => r.blockedUntilMinute !== null);
  if (!blocked) return next;
  blocked.blockedUntilMinute = minute;
  return next;
}

/** The worlds this search will run every candidate against. */
export function stubWorlds(scenario: Scenario): Scenario[] {
  const blocked = scenario.resources.find((r) => r.blockedUntilMinute !== null);
  if (!blocked) return [scenario];
  return ETA_SPREAD_MINUTES.map((minute) => worldWithPartEta(scenario, minute));
}

/** Human-readable description of the sample, for the panel and the logs. */
export function describeWorlds(scenario: Scenario): string {
  const worlds = stubWorlds(scenario);
  if (worlds.length === 1) return "one world";
  return `${worlds.length} supplier ETAs, ${formatMinute(ETA_SPREAD_MINUTES[0])}–${formatMinute(
    ETA_SPREAD_MINUTES[ETA_SPREAD_MINUTES.length - 1],
  )}`;
}

/* -------------------------------------------------------------- evaluation */

interface WorldOutcome {
  promisesMet: number;
  promisedTotal: number;
  completed: number;
  constraintViolations: string[];
}

function evaluateWorld(world: Scenario, changes: PlanChange[]): WorldOutcome {
  const totals = simulate(changes.reduce(applyScheduleChange, world)).totals;
  return {
    promisesMet: totals.promisesMet,
    promisedTotal: totals.promisedTotal,
    completed: totals.completed,
    constraintViolations: totals.constraintViolations,
  };
}

/**
 * Every figure on a candidate is measured: the rate is the share of worlds in
 * which the plan kept every promise, and the headline numbers come from the
 * world the shop is actually in (the first one).
 */
function candidateFrom(
  plan: (typeof STUB_CANDIDATE_PLANS)[number],
  outcomes: WorldOutcome[],
): ExplorationCandidate {
  const kept = outcomes.filter((o) => o.promisesMet === o.promisedTotal).length;
  const nominal = outcomes[Math.min(2, outcomes.length - 1)];
  return {
    id: plan.id,
    label: plan.label,
    changes: plan.changes,
    promisesMetRate: kept / outcomes.length,
    promisesMet: nominal.promisesMet,
    promisedTotal: nominal.promisedTotal,
    completed: nominal.completed,
    constraintViolations: [...new Set(outcomes.flatMap((o) => o.constraintViolations))],
  };
}

/** Stated objective, in order. Nothing else decides the winner. */
export function rankCandidates(candidates: ExplorationCandidate[]): ExplorationCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.promisesMetRate - a.promisesMetRate ||
      b.promisesMet - a.promisesMet ||
      b.completed - a.completed ||
      (a.id < b.id ? -1 : 1),
  );
}

/* ----------------------------------------------------------------- runner */

export interface ExplorationRunOptions {
  /** The live world the search runs against. */
  scenario: Scenario;
  seed?: number;
  replications?: number;
  /** Called on every tick, including the first and the last. */
  onProgress?: (progress: ExplorationProgress) => void;
  signal?: AbortSignal;
  /** 0 runs without yielding — used by the tests. */
  tickMs?: number;
}

/**
 * The contract the real engine call must satisfy. `storySlice` depends on this
 * type, never on the stub itself.
 */
export type ExplorationRunner = (
  options: ExplorationRunOptions,
) => Promise<ExplorationSummary>;

export class ExplorationAborted extends Error {
  constructor() {
    super("Exploration cancelled.");
    this.name = "ExplorationAborted";
  }
}

export function isExplorationAborted(error: unknown): boolean {
  return error instanceof ExplorationAborted;
}

/** Rows for the panel, straight from what has been measured so far. */
function rowsFrom(
  done: ExplorationCandidate[],
  currentIndex: number,
  currentProgress: number,
): ExplorationProgress["rows"] {
  return STUB_CANDIDATE_PLANS.map((plan, index) => {
    const measured = done.find((c) => c.id === plan.id) ?? null;
    return {
      id: plan.id,
      label: plan.label,
      progress: measured ? 1 : index === currentIndex ? currentProgress : 0,
      promisesMet: measured ? measured.promisesMet : null,
      promisesMetRate: measured ? measured.promisesMetRate : null,
    };
  });
}

/**
 * TODO(engine): replaced at I1. Runs every candidate against every world with
 * the real engine, streaming progress as the runs actually complete.
 */
export const runExplorationStub: ExplorationRunner = async ({
  scenario,
  seed = STORY_SEED,
  onProgress,
  signal,
  tickMs = STORY_TICK_MS,
}) => {
  const worlds = stubWorlds(scenario);
  const runsPlanned = STUB_CANDIDATE_PLANS.length * worlds.length;
  const measured: ExplorationCandidate[] = [];
  let runsExecuted = 0;

  const emit = (index: number, progress: number) =>
    onProgress?.({
      status: "running",
      runsExecuted,
      runsPlanned,
      rows: rowsFrom(measured, index, progress),
      best: measured.length > 0 ? rankCandidates(measured)[0] : null,
    });

  emit(0, 0);
  for (const [index, plan] of STUB_CANDIDATE_PLANS.entries()) {
    const outcomes: WorldOutcome[] = [];
    for (const world of worlds) {
      if (signal?.aborted) throw new ExplorationAborted();
      if (tickMs > 0) await new Promise((resolve) => setTimeout(resolve, tickMs));
      outcomes.push(evaluateWorld(world, plan.changes));
      runsExecuted += 1;
      emit(index, outcomes.length / worlds.length);
    }
    measured.push(candidateFrom(plan, outcomes));
    emit(index + 1, 0);
  }

  const ranked = rankCandidates(measured);
  return {
    scenarioId: scenario.id,
    seed,
    // What it actually ran, not what it was asked for.
    replications: worlds.length,
    candidatesEvaluated: STUB_CANDIDATE_PLANS.length,
    runsExecuted,
    best: ranked[0] ?? null,
    top: ranked.slice(0, 8),
  };
};

/** The winner, as the plan the proposal card works with. */
export function planFromCandidate(candidate: ExplorationCandidate): Plan {
  return { id: `PLAN-${candidate.id}`, label: candidate.label, changes: candidate.changes };
}
