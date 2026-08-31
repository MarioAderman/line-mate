"use client";

/**
 * Story orchestration: the five beats of the demo, driven from one place.
 *
 * This is not a second world model. Every world change goes through
 * `store.run(...)` — the same command layer the WebMCP agent calls — including
 * the demo reset, which is the human-only `reset_demo` command. What the slice
 * keeps of its own is view state: which beat is on screen, the exploration
 * progress, and the *draft* proposal.
 *
 * The draft is the point of beat 4. A proposed plan is not a scenario: it is
 * changes the human can still retarget. Nothing reaches any scenario until
 * Apply, and Apply runs exactly the draft that was on screen — so what the
 * manager sees is what runs, and the protected baseline is untouched all the
 * way through beats 3 and 4.
 *
 * A beat only advances when its commands actually succeeded. `resolved` is
 * stricter still: the simulation must show every promise kept and the shift
 * note must really be in state. The screen never claims an outcome the world
 * does not have.
 *
 * Beats: calm → escalation → running → proposal → resolved.
 */
import { useMemo } from "react";
import {
  BASELINE_SCENARIO_ID,
  PART_DELAY,
  type Actor,
  type ExplorationProgress,
  type ExplorationSummary,
  type NoteChannel,
  type Plan,
  type PlanChange,
  type ShiftNote,
  type StoryState,
} from "@/domain";
import { type CommandResult } from "@/commands";
import {
  ExplorationAborted,
  STORY_SEED,
  STORY_TICK_MS,
  isExplorationAborted,
  type ExplorationRunner,
} from "@/components/story/exploration";
import { planFromCandidate } from "@/simulation";
import { IDLE_EXPLORATION, useWorkshopStore, type WorkshopStore } from "./workshopStore";

/* ------------------------------------------------------------- story copy */

/** Who the shift note goes to. Rendered as chips; nothing leaves the page. */
export const NOTE_CHANNELS: NoteChannel[] = ["slack", "email", "sms"];
export const NOTE_RECIPIENTS = ["Ana", "Carlos", "Luis"];

export const DEFAULT_NOTE_TEXT =
  "Bay 3 is clear from 15:30. The brown van rolls off the lift and finishes in the first bay " +
  "that frees up, the black wagon stops waiting for Bay 3, and the promised cars run ahead of " +
  "the walk-ins. All six promises are back on plan — no overtime.";

/** Name of the branch the plan is applied on, so the baseline stays intact. */
export const RECOVERY_SCENARIO_NAME = "Human + agent";

/* ------------------------------------------------------------- step result */

export interface StoryCommandLog {
  name: string;
  /** The payload the beat sent — the contract the engine commands must accept. */
  input: unknown;
  ok: boolean;
  error?: string;
}

export interface StoryStepResult {
  /** True when the beat did everything it set out to do. */
  ok: boolean;
  story: StoryState;
  commands: StoryCommandLog[];
  /** First thing that went wrong, ready to put on screen. */
  error: string | null;
}

export type ExplorationSource = "command" | "injected";

export interface StoryExplorationResult extends StoryStepResult {
  summary: ExplorationSummary | null;
  /** True when the run was superseded by a newer one or cancelled. */
  cancelled: boolean;
  /** Where the one search came from. */
  servedBy: ExplorationSource;
}

export interface StoryProposalResult extends StoryStepResult {
  plan: Plan | null;
}

function step(
  log: StoryCommandLog[],
  name: string,
  input: unknown,
  actor: Actor,
): CommandResult {
  const result = useWorkshopStore.getState().run(name, input, actor);
  log.push(
    result.ok ? { name, input, ok: true } : { name, input, ok: false, error: result.error },
  );
  return result;
}

function firstError(log: StoryCommandLog[]): string | null {
  return log.find((entry) => !entry.ok)?.error ?? null;
}

function result(log: StoryCommandLog[], extra: string | null = null): StoryStepResult {
  const error = extra ?? firstError(log);
  return {
    ok: error === null,
    story: useWorkshopStore.getState().story,
    commands: log,
    error,
  };
}

/**
 * Moves the screen on only when the beat earned it — and only when the beat
 * order allows it. Returns the result so callers can hand the error straight
 * to the panel.
 */
function advanceIf(
  log: StoryCommandLog[],
  to: StoryState,
  extra: string | null = null,
): StoryStepResult {
  const error = extra ?? firstError(log);
  if (error !== null) return result(log, error);
  const from = useWorkshopStore.getState().story;
  if (!useWorkshopStore.getState().setStory(to)) {
    return result(log, `The demo is on "${from}"; "${to}" does not follow it.`);
  }
  return result(log);
}

/* ---------------------------------------------------------- draft proposal */

/**
 * Finding 1 (I1): the draft lives in the ONE canonical store as view state —
 * `draft`, `humanEdited`, `applyError` on `WorkshopStore`. These wrappers keep
 * the beat API in one place; there is no second Zustand store.
 */
export function draftPlan(): Plan | null {
  return useWorkshopStore.getState().draft;
}

/**
 * Where a drop from a lane or a bay goes. During beat 4 it edits the draft;
 * at any other moment it is an ordinary human routing decision on the world.
 * One entry point, so a drop target cannot get the distinction wrong.
 */
export function routeFromDrop(
  workItemId: string,
  resourceId: string | null,
  position: number | null = 1,
): StoryStepResult {
  const store = useWorkshopStore.getState();
  if (store.story === "proposal" && store.draft !== null) {
    store.routeInDraft(workItemId, resourceId, position);
    return { ok: true, story: "proposal", commands: [], error: null };
  }
  const log: StoryCommandLog[] = [];
  step(
    log,
    "route_work_item",
    { workItemId, resourceId, position: resourceId === null ? null : position },
    "human",
  );
  return result(log);
}

/* ------------------------------------------------------------ beat 2: escalation */

export interface EscalationOptions {
  actor?: Actor;
}

/**
 * The part delay lands: inject it, re-run the shift, and put the screen on the
 * escalation beat. Attributed to `simulation` — nobody chose this.
 */
export function startEscalation(options: EscalationOptions = {}): StoryStepResult {
  const actor = options.actor ?? "simulation";
  const log: StoryCommandLog[] = [];
  // TODO(engine): `inject_event` is engine-explorer's. Until it lands the beat
  // reports the unknown command and the screen stays where it is.
  step(log, "inject_event", { disruption: PART_DELAY }, actor);
  if (firstError(log) === null) step(log, "run_simulation", {}, actor);
  return advanceIf(log, "escalation");
}

/* ------------------------------------------------------------- beat 3: running */

export class ExplorationFailed extends Error {}

/**
 * The one search (finding 3): a single attributed `explore_schedules` call
 * with `includeTrace`. The command runs the engine iterator ONCE; its trace
 * frames are replayed here as the visible progress and its summary is what
 * the panel shows. No second search anywhere.
 */
const commandRunner: ExplorationRunner = async ({
  scenario,
  seed,
  replications,
  onProgress,
  signal,
  tickMs = STORY_TICK_MS,
}) => {
  const call = useWorkshopStore
    .getState()
    .run(
      "explore_schedules",
      { scenarioId: scenario.id, seed, replications, includeTrace: true },
      "agent",
    );
  if (!call.ok) throw new ExplorationFailed(call.error);
  const data = call.data as ExplorationSummary & { trace?: ExplorationProgress[] };
  const { trace = [], ...summary } = data;
  for (const frame of trace) {
    if (signal?.aborted) throw new ExplorationAborted();
    if (tickMs > 0) await new Promise((resolve) => setTimeout(resolve, tickMs));
    onProgress?.(frame);
  }
  return summary;
};

export const defaultExplorationRunner: ExplorationRunner = commandRunner;

export interface ExplorationOptions {
  /** TODO(engine): pass the chunked `exploreSchedules` here at integration. */
  runner?: ExplorationRunner;
  seed?: number;
  replications?: number;
  /** Milliseconds between progress ticks; 0 finishes immediately (tests). */
  tickMs?: number;
  signal?: AbortSignal;
}

let inFlight: AbortController | null = null;

/** Cancels a running exploration, if any. */
export function cancelExploration(): void {
  inFlight?.abort();
  inFlight = null;
}

/** The panel state a summary implies. The summary is the only source. */
export function progressFromSummary(summary: ExplorationSummary): ExplorationProgress {
  return {
    status: "done",
    runsExecuted: summary.runsExecuted,
    runsPlanned: summary.runsExecuted,
    rows: summary.top.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      progress: 1,
      promisesMet: candidate.promisesMet,
      promisesMetRate: candidate.promisesMetRate,
    })),
    best: summary.best,
  };
}

/**
 * Runs the schedule search and streams its progress into the store. On failure
 * the screen goes back to the beat it came from, carrying the error.
 */
export async function startExploration(
  options: ExplorationOptions = {},
): Promise<StoryExplorationResult> {
  const log: StoryCommandLog[] = [];
  const store = useWorkshopStore.getState();
  const scenario = store.scenarios.find((s) => s.id === store.activeScenarioId);
  const previousStory = store.story;
  const servedBy: ExplorationSource = options.runner ? "injected" : "command";

  if (!scenario) {
    return { ...result(log, "No active scenario."), summary: null, cancelled: false, servedBy };
  }

  const seed = options.seed ?? STORY_SEED;
  const runner = options.runner ?? defaultExplorationRunner;

  // Never burn a search the screen is not allowed to show.
  if (!store.setStory("running")) {
    return {
      ...result(log, `The demo is on "${previousStory}"; the search follows the escalation.`),
      summary: null,
      cancelled: false,
      servedBy,
    };
  }

  cancelExploration();
  const controller = new AbortController();
  inFlight = controller;
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  store.setExploration({ ...IDLE_EXPLORATION, status: "running" });

  let summary: ExplorationSummary;
  try {
    summary = await runner({
      scenario,
      seed,
      replications: options.replications,
      tickMs: options.tickMs,
      signal: controller.signal,
      onProgress: (progress) => useWorkshopStore.getState().setExploration(progress),
    });
  } catch (error) {
    if (isExplorationAborted(error) || controller.signal.aborted) {
      return { ...result(log), summary: null, cancelled: true, servedBy };
    }
    const message = error instanceof Error ? error.message : String(error);
    log.push({ name: "explore_schedules", input: { scenarioId: scenario.id, seed }, ok: false, error: message });
    // Nothing was found: go back to the beat we came from rather than sit on
    // an empty search panel.
    useWorkshopStore.getState().setStory(previousStory);
    useWorkshopStore.getState().setExploration(IDLE_EXPLORATION);
    return { ...result(log), summary: null, cancelled: false, servedBy };
  } finally {
    if (inFlight === controller) inFlight = null;
  }
  if (controller.signal.aborted) {
    return { ...result(log), summary: null, cancelled: true, servedBy };
  }

  log.push({ name: "explore_schedules", input: { scenarioId: scenario.id, seed }, ok: true });
  // The summary is the display: rows, best and rate all come from it.
  useWorkshopStore.getState().setExploration(progressFromSummary(summary));
  return { ...result(log), summary, cancelled: false, servedBy };
}

/* ------------------------------------------------------------ beat 4: proposal */

/** The winning candidate, as a plan. */
export function proposedPlan(state: Pick<WorkshopStore, "exploration">): Plan | null {
  return state.exploration.best ? planFromCandidate(state.exploration.best) : null;
}

/**
 * Puts the proposal on screen as an editable draft. No world change: the plan
 * is data until Apply.
 */
export function proposal(plan?: Plan): StoryProposalResult {
  const store = useWorkshopStore.getState();
  const chosen = plan ?? proposedPlan(store);
  if (!chosen) {
    return {
      ...result([], "No plan to propose — run the exploration first."),
      plan: null,
    };
  }
  const advanced = advanceIf([], "proposal");
  if (!advanced.ok) return { ...advanced, plan: null };
  useWorkshopStore.getState().setDraft(structuredClone(chosen));
  return { ...advanced, plan: chosen };
}

/* ------------------------------------------------------------ beat 5: resolved */

/** A plan change is literally a command call; this is its payload. */
export function planChangeInput(change: PlanChange): Record<string, unknown> {
  return change.command === "update_work_item"
    ? { workItemId: change.workItemId, changes: { priority: change.priority } }
    : {
        workItemId: change.workItemId,
        resourceId: change.resourceId,
        position: change.position,
      };
}

export interface ApplyOptions {
  actor?: Actor;
  channels?: NoteChannel[];
  recipients?: string[];
  scenarioName?: string;
}

/**
 * Branch off the baseline, apply exactly the draft on screen, re-run the shift
 * and post the note. `resolved` is only reached if the run really keeps every
 * promise and the note is really in state.
 *
 * Defaults to `human`: on the button path it is the person applying it.
 */
export function applyAndNotify(
  plan?: Plan,
  noteText: string = DEFAULT_NOTE_TEXT,
  options: ApplyOptions = {},
): StoryStepResult {
  const outcome = applyAndNotifyInner(plan, noteText, options);
  useWorkshopStore.getState().setApplyError(outcome.ok ? null : outcome.error);
  return outcome;
}

function applyAndNotifyInner(
  plan?: Plan,
  noteText: string = DEFAULT_NOTE_TEXT,
  options: ApplyOptions = {},
): StoryStepResult {
  const actor = options.actor ?? "human";
  const log: StoryCommandLog[] = [];
  const store = useWorkshopStore.getState();
  const chosen = plan ?? draftPlan();

  if (!chosen) {
    return result(log, "No plan to apply — run the exploration first.");
  }

  if (store.activeScenarioId === BASELINE_SCENARIO_ID) {
    step(
      log,
      "create_scenario",
      {
        name: options.scenarioName ?? RECOVERY_SCENARIO_NAME,
        description: chosen.label,
        activate: true,
      },
      actor,
    );
    if (firstError(log) !== null) return result(log);
  }

  step(log, "apply_plan", { plan: chosen }, actor);
  if (firstError(log) !== null) return result(log);

  step(log, "run_simulation", {}, actor);
  if (firstError(log) !== null) return result(log);

  // The screen may only claim success the simulation actually shows.
  const after = useWorkshopStore.getState();
  const totals = after.simulations[after.activeScenarioId]?.totals;
  if (!totals) {
    return result(log, "The plan was applied but the shift has not been simulated.");
  }
  if (totals.promisesMet !== totals.promisedTotal) {
    return result(
      log,
      `Applied, but the run keeps ${totals.promisesMet} of ${totals.promisedTotal} promises. Adjust the plan and apply again.`,
    );
  }

  const posted = step(
    log,
    "post_shift_note",
    {
      text: noteText,
      channels: options.channels ?? NOTE_CHANNELS,
      recipients: options.recipients ?? NOTE_RECIPIENTS,
    },
    actor,
  );
  if (firstError(log) !== null) return result(log);

  // Never announce a note that was not stored — and it must be THIS run's
  // note, on the scenario that was just applied, not any note lying around.
  const noteId = posted.ok
    ? (posted.data as { note?: { id: string } }).note?.id ?? null
    : null;
  const world = useWorkshopStore.getState();
  const stored =
    noteId !== null &&
    world.notes.some((n) => n.id === noteId && n.scenarioId === world.activeScenarioId);
  if (!stored) {
    return result(log, "The team was not notified — no shift note was stored.");
  }

  return advanceIf(log, "resolved");
}

/* ---------------------------------------------------------------- reset */

/**
 * Back to the calm shop for another take. The world is rebuilt by the
 * human-only `reset_demo` command — the slice never writes world state — and
 * only the view state of the story is cleared here.
 */
export function reset(): StoryStepResult {
  const log: StoryCommandLog[] = [];
  cancelExploration();
  // The store's command interception applies RESET_VIEW on success: the world
  // is rebuilt by the human-only command, the view snaps to the opening frame,
  // and the WebMCP link and viewport survive because they describe the room.
  step(log, "reset_demo", { story: "calm" }, "human");
  return result(log);
}

/* ---------------------------------------------------------------- hooks */

export function useStory(): StoryState {
  return useWorkshopStore((s) => s.story);
}

export function useExploration(): ExplorationProgress {
  return useWorkshopStore((s) => s.exploration);
}

/** The draft the proposal card edits — null outside beat 4. */
export function useDraftPlan(): Plan | null {
  return useWorkshopStore((s) => s.draft);
}

export function useHumanEdited(): string[] {
  return useWorkshopStore((s) => s.humanEdited);
}

/** Why the last apply was refused — null when the plan has not been tried. */
export function useApplyError(): string | null {
  return useWorkshopStore((s) => s.applyError);
}

/** The winner as the exploration reported it, before any human edit. */
export function useProposedPlan(): Plan | null {
  const best = useWorkshopStore((s) => s.exploration.best);
  return useMemo(() => (best ? planFromCandidate(best) : null), [best]);
}

/** Newest shift note, or null when none was stored. */
export function useLatestNote(): ShiftNote | null {
  return useWorkshopStore((s) => s.notes[0] ?? null);
}

export interface StoryActions {
  startEscalation: typeof startEscalation;
  startExploration: typeof startExploration;
  proposal: typeof proposal;
  applyAndNotify: typeof applyAndNotify;
  routeFromDrop: typeof routeFromDrop;
  reset: typeof reset;
}

/** Stable references — the beats are module functions, not store state. */
export const STORY_ACTIONS: StoryActions = {
  startEscalation,
  startExploration,
  proposal,
  applyAndNotify,
  routeFromDrop,
  reset,
};

export function useStoryActions(): StoryActions {
  return STORY_ACTIONS;
}
