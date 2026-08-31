/**
 * The exploration contract the story beats depend on.
 *
 * The search itself lives in the engine (`explore_schedules`, one attributed
 * command per exploration — its `includeTrace` frames and its summary come
 * from the same run of the iterator). This module only carries the runner
 * type, the demo seed, and cancellation.
 */
import type { ExplorationProgress, ExplorationSummary, Scenario } from "@/domain";

/** Frozen so the demo reproduces exactly without anyone passing a seed. */
export const STORY_SEED = 20260829;

/** Milliseconds between replayed progress frames on the UI path. */
/** ~36 trace frames x 420ms ≈ 15s: fast, but visibly running (Mario's call). */
export const STORY_TICK_MS = 420;

export interface ExplorationRunOptions {
  /** The live world the search runs against. */
  scenario: Scenario;
  seed?: number;
  replications?: number;
  /** Called on every progress frame, including the final one. */
  onProgress?: (progress: ExplorationProgress) => void;
  signal?: AbortSignal;
  /** 0 replays the frames without waiting — used by the tests. */
  tickMs?: number;
}

/** Anything that can serve the one search: the command, or an injected fake. */
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
