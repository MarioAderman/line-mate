/**
 * TODO(engine): temporary stand-in for `exploreSchedules` / `explore_schedules`.
 *
 * `engine-explorer` is building the real bounded, seeded search in
 * `src/simulation/explore.ts` (input `{ scenarioId?, seed?, replications? }`,
 * output `ExplorationSummary`, plus a chunked variant that reports
 * `ExplorationProgress`). Until it lands, the story panels need something with
 * exactly that shape so the five beats can be built, recorded and tested.
 *
 * This file replays a frozen, deterministic script of that search: the same
 * candidate families, the same counters, the same winner. It contains no
 * simulation of its own and no second world model — the winning candidate's
 * changes are the demo plan from `src/domain/demo.ts`, so applying it through
 * the command layer really does produce 6/6.
 *
 * Swapping it in is one line in `src/store/storySlice.ts`: pass a `runner`
 * backed by the chunked engine call.
 */
import {
  AGENT_PLAN,
  HUMAN_DECISION,
  type ExplorationCandidate,
  type ExplorationProgress,
  type ExplorationRow,
  type ExplorationSummary,
  type Plan,
  type PlanChange,
} from "@/domain";

/** Seed the story runs with, so the counters are the same in every take. */
export const STORY_SEED = 20260829;
/** Seeded replications per candidate — `runsExecuted = candidates × this`. */
export const STORY_REPLICATIONS = 8;
/** Progress steps each candidate family takes to fill its bar. */
const TICKS_PER_ROW = 3;
/** Milliseconds between progress ticks (~2.2 s for the whole search). */
export const STORY_TICK_MS = 110;

const PRIORITY_FIRST: PlanChange[] = AGENT_PLAN.changes.filter(
  (c) => c.command === "update_work_item",
);
const FREE_THE_WAGON: PlanChange[] = AGENT_PLAN.changes.filter(
  (c) => c.command === "route_work_item",
);

interface StubFamily {
  id: string;
  label: string;
  /** Candidates this family stands for; they add up to `candidatesEvaluated`. */
  candidates: number;
  promisesMet: number;
  promisesMetRate: number;
  completed: number;
  changes: PlanChange[];
}

/**
 * Six candidate families, in the order the search reports them. The winner is
 * fifth: the last family still runs and loses, so the panel shows a real search
 * rather than a scripted reveal.
 */
const FAMILIES: StubFamily[] = [
  {
    id: "EXP-01",
    label: "Promised cars ahead of walk-ins",
    candidates: 6,
    promisesMet: 5,
    promisesMetRate: 0.71,
    completed: 11,
    changes: PRIORITY_FIRST,
  },
  {
    id: "EXP-02",
    label: "Free the wagon from Bay 3",
    candidates: 5,
    promisesMet: 5,
    promisesMetRate: 0.68,
    completed: 11,
    changes: [...PRIORITY_FIRST, ...FREE_THE_WAGON],
  },
  {
    id: "EXP-03",
    label: "Hold the walk-ins until 16:30",
    candidates: 7,
    promisesMet: 4,
    promisesMetRate: 0.22,
    completed: 10,
    changes: PRIORITY_FIRST,
  },
  {
    id: "EXP-04",
    label: "Diagnostics first, harness repair after",
    candidates: 6,
    promisesMet: 5,
    promisesMetRate: 0.77,
    completed: 11,
    changes: [...PRIORITY_FIRST, ...FREE_THE_WAGON],
  },
  {
    id: "EXP-05",
    label: "SUV first into Bay 3 at 15:30",
    candidates: 8,
    promisesMet: 6,
    promisesMetRate: 0.94,
    completed: 12,
    changes: [...AGENT_PLAN.changes, ...HUMAN_DECISION.changes],
  },
  {
    id: "EXP-06",
    label: "Coupe and pickup share Bay 1",
    candidates: 4,
    promisesMet: 5,
    promisesMetRate: 0.63,
    completed: 11,
    changes: [...PRIORITY_FIRST, ...FREE_THE_WAGON],
  },
];

const PROMISED_TOTAL = 6;
const CANDIDATES_EVALUATED = FAMILIES.reduce((sum, f) => sum + f.candidates, 0);

function candidateOf(family: StubFamily): ExplorationCandidate {
  return {
    id: family.id,
    label: family.label,
    changes: family.changes,
    promisesMetRate: family.promisesMetRate,
    promisesMet: family.promisesMet,
    promisedTotal: PROMISED_TOTAL,
    completed: family.completed,
    constraintViolations: [],
  };
}

/** Higher promise rate wins; ties break on promises met, then on id. */
function better(a: ExplorationCandidate, b: ExplorationCandidate): ExplorationCandidate {
  if (b.promisesMetRate !== a.promisesMetRate) {
    return b.promisesMetRate > a.promisesMetRate ? b : a;
  }
  if (b.promisesMet !== a.promisesMet) return b.promisesMet > a.promisesMet ? b : a;
  return b.id < a.id ? b : a;
}

export interface ExplorationRunOptions {
  scenarioId: string;
  seed?: number;
  replications?: number;
  /** Called on every tick, including the first and the last. */
  onProgress?: (progress: ExplorationProgress) => void;
  signal?: AbortSignal;
  /** 0 resolves the whole run on the microtask queue — used by the tests. */
  tickMs?: number;
}

/**
 * The contract the real engine call must satisfy. `storySlice` depends on this
 * type, never on the stub itself.
 */
export type ExplorationRunner = (
  options: ExplorationRunOptions,
) => Promise<ExplorationSummary>;

/**
 * Every progress snapshot of the scripted search, start to finish. Pure: the
 * animation is just this list, played back on a timer.
 */
export function explorationStubSnapshots(replications = STORY_REPLICATIONS): ExplorationProgress[] {
  const runsPlanned = CANDIDATES_EVALUATED * replications;
  const rows = (upTo: number, partial: number): ExplorationRow[] =>
    FAMILIES.map((family, index) => {
      const done = index < upTo;
      const progress = done ? 1 : index === upTo ? partial : 0;
      return {
        id: family.id,
        label: family.label,
        progress,
        promisesMet: done ? family.promisesMet : null,
        promisesMetRate: done ? family.promisesMetRate : null,
      };
    });

  const runsAfter = (upTo: number, partial: number): number => {
    let runs = 0;
    FAMILIES.forEach((family, index) => {
      if (index < upTo) runs += family.candidates * replications;
      else if (index === upTo) runs += Math.round(family.candidates * replications * partial);
    });
    return runs;
  };

  const bestAfter = (upTo: number): ExplorationCandidate | null =>
    FAMILIES.slice(0, upTo).map(candidateOf).reduce<ExplorationCandidate | null>(
      (best, candidate) => (best === null ? candidate : better(best, candidate)),
      null,
    );

  const snapshots: ExplorationProgress[] = [
    { status: "running", runsExecuted: 0, runsPlanned, rows: rows(0, 0), best: null },
  ];
  FAMILIES.forEach((_, index) => {
    for (let tick = 1; tick <= TICKS_PER_ROW; tick += 1) {
      const partial = tick / TICKS_PER_ROW;
      const complete = tick === TICKS_PER_ROW;
      snapshots.push({
        status: "running",
        runsExecuted: runsAfter(complete ? index + 1 : index, complete ? 0 : partial),
        runsPlanned,
        rows: rows(complete ? index + 1 : index, complete ? 0 : partial),
        best: bestAfter(complete ? index + 1 : index),
      });
    }
  });
  snapshots.push({
    status: "done",
    runsExecuted: runsPlanned,
    runsPlanned,
    rows: rows(FAMILIES.length, 0),
    best: bestAfter(FAMILIES.length),
  });
  return snapshots;
}

/** The summary the run ends on — what `explore_schedules` will return. */
export function explorationStubSummary(
  scenarioId: string,
  seed = STORY_SEED,
  replications = STORY_REPLICATIONS,
): ExplorationSummary {
  const ranked = FAMILIES.map(candidateOf).sort(
    (a, b) =>
      b.promisesMetRate - a.promisesMetRate ||
      b.promisesMet - a.promisesMet ||
      (a.id < b.id ? -1 : 1),
  );
  return {
    scenarioId,
    seed,
    replications,
    candidatesEvaluated: CANDIDATES_EVALUATED,
    runsExecuted: CANDIDATES_EVALUATED * replications,
    best: ranked[0] ?? null,
    top: ranked.slice(0, 8),
  };
}

class ExplorationAborted extends Error {
  constructor() {
    super("Exploration cancelled.");
    this.name = "ExplorationAborted";
  }
}

export function isExplorationAborted(error: unknown): boolean {
  return error instanceof ExplorationAborted;
}

/** TODO(engine): replace with the chunked `exploreSchedules` call. */
export const runExplorationStub: ExplorationRunner = async ({
  scenarioId,
  seed = STORY_SEED,
  replications = STORY_REPLICATIONS,
  onProgress,
  signal,
  tickMs = STORY_TICK_MS,
}) => {
  const snapshots = explorationStubSnapshots(replications);
  for (const snapshot of snapshots) {
    if (signal?.aborted) throw new ExplorationAborted();
    if (tickMs > 0) await new Promise((resolve) => setTimeout(resolve, tickMs));
    onProgress?.(snapshot);
  }
  return explorationStubSummary(scenarioId, seed, replications);
};

/** The exploration's winner, as the plan the proposal card works with. */
export function planFromCandidate(candidate: ExplorationCandidate): Plan {
  return { id: `PLAN-${candidate.id}`, label: candidate.label, changes: candidate.changes };
}
