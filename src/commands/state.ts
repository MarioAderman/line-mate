/**
 * The command layer owns the shape of application world state.
 *
 * The Zustand store holds this object; every read and every mutation of it
 * goes through `executeCommand`, whether the caller is the human clicking
 * the floor or the external agent calling a WebMCP tool. That is the
 * invariant the whole demo rests on (docs/architecture.md, "Core rule").
 */
import {
  BASELINE_SCENARIO_ID,
  FIXTURE_CREATED_AT,
  workshopFixture,
  type Actor,
  type Change,
  type Scenario,
} from "@/domain";
import type { SimulationResult } from "@/simulation";

export interface WorkshopState {
  scenarios: Scenario[];
  activeScenarioId: string;
  /** Cached simulation output, keyed by scenario id. */
  simulations: Record<string, SimulationResult>;
  /** Newest first. Drives the attributed activity strip. */
  changes: Change[];
  /** Monotonic counter used to mint ids without a clock or randomness. */
  sequence: number;
}

export const SEED_CHANGE: Change = {
  id: "CHG-0",
  at: Date.parse(FIXTURE_CREATED_AT),
  actor: "simulation",
  command: "load_fixture",
  scenarioId: BASELINE_SCENARIO_ID,
  summary: "Friday 14:15 — baseline loaded. Six promises before closing.",
  before: null,
  after: null,
};

export function createInitialState(): WorkshopState {
  return {
    scenarios: [workshopFixture()],
    activeScenarioId: BASELINE_SCENARIO_ID,
    simulations: {},
    changes: [SEED_CHANGE],
    sequence: 1,
  };
}

export interface CommandContext {
  getState(): WorkshopState;
  setState(updater: (state: WorkshopState) => WorkshopState): void;
  /** Injectable clock — tests pass a fixed one so output stays deterministic. */
  now(): number;
  /** Attribution for anything this context mutates. */
  actor: Actor;
}

/** In-memory context, used by tests and by any non-React caller. */
export function createMemoryContext(
  actor: Actor = "human",
  initial: WorkshopState = createInitialState(),
  now: () => number = () => SEED_CHANGE.at,
): CommandContext & { readonly state: WorkshopState } {
  const box = { state: initial };
  return {
    get state() {
      return box.state;
    },
    getState: () => box.state,
    setState: (updater) => {
      box.state = updater(box.state);
    },
    now,
    actor,
  };
}
