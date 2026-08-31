"use client";

/**
 * Story orchestration: the five beats of the demo, driven from one place.
 *
 * This is not a second world model. Every world change here goes through
 * `store.run(...)` — the same command layer the WebMCP agent calls — and
 * everything else it touches (`story`, `exploration`) is view state the store
 * already owns. It exists so the keyboard demo controls, the story panels and
 * (at integration) the agent tools all move the beats the same way, in the same
 * order, with the same attribution.
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
import { COMMAND_NAMES, createInitialState, type CommandResult } from "@/commands";
import {
  STORY_REPLICATIONS,
  STORY_SEED,
  isExplorationAborted,
  planFromCandidate,
  runExplorationStub,
  type ExplorationRunner,
} from "@/components/story/explorationStub";
import { IDLE_EXPLORATION, useWorkshopStore, type WorkshopStore } from "./workshopStore";

/* ------------------------------------------------------------- story copy */

/** Who the shift note goes to. Rendered as chips; nothing leaves the page. */
export const NOTE_CHANNELS: NoteChannel[] = ["slack", "email", "sms"];
export const NOTE_RECIPIENTS = ["Ana", "Carlos", "Luis"];

export const DEFAULT_NOTE_TEXT =
  "Bay 3 is clear from 15:30. The white SUV goes in first, the black wagon takes the next " +
  "open bay, and the promised cars run ahead of the walk-ins. All six promises are back on " +
  "plan — no overtime.";

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
  /** True when every command the beat attempted succeeded. */
  ok: boolean;
  story: StoryState;
  commands: StoryCommandLog[];
}

export interface StoryExplorationResult extends StoryStepResult {
  summary: ExplorationSummary | null;
  /** True when the run was superseded by a newer one or cancelled. */
  cancelled: boolean;
}

export interface StoryProposalResult extends StoryStepResult {
  plan: Plan | null;
}

function hasCommand(name: string): boolean {
  return COMMAND_NAMES.includes(name);
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

function finish(log: StoryCommandLog[]): StoryStepResult {
  return {
    ok: log.every((entry) => entry.ok),
    story: useWorkshopStore.getState().story,
    commands: log,
  };
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
  // TODO(engine): `inject_event` is engine-explorer's; until it lands this
  // reports as an unknown command and the world stays as loaded.
  step(log, "inject_event", { disruption: PART_DELAY }, actor);
  step(log, "run_simulation", {}, actor);
  useWorkshopStore.getState().setStory("escalation");
  return finish(log);
}

/* ------------------------------------------------------------- beat 3: running */

export interface ExplorationOptions {
  /** TODO(engine): pass the chunked `exploreSchedules` here at integration. */
  runner?: ExplorationRunner;
  seed?: number;
  replications?: number;
  /** Milliseconds between progress ticks; 0 finishes immediately (tests). */
  tickMs?: number;
  /**
   * Also call `explore_schedules` so the run is attributed in the change log.
   * Defaults to true for the built-in stub and false for an injected runner,
   * which would otherwise search twice.
   */
  recordCommand?: boolean;
  signal?: AbortSignal;
}

let inFlight: AbortController | null = null;

/** Cancels a running exploration, if any. */
export function cancelExploration(): void {
  inFlight?.abort();
  inFlight = null;
}

/**
 * Runs the schedule search and streams its progress into the store so the
 * scenarios panel can animate it. Resolves with the summary the proposal is
 * built from.
 */
export async function startExploration(
  options: ExplorationOptions = {},
): Promise<StoryExplorationResult> {
  const log: StoryCommandLog[] = [];
  const store = useWorkshopStore.getState();
  const scenarioId = store.activeScenarioId;
  const seed = options.seed ?? STORY_SEED;
  const replications = options.replications ?? STORY_REPLICATIONS;
  const runner = options.runner ?? runExplorationStub;
  const recordCommand = options.recordCommand ?? options.runner === undefined;

  cancelExploration();
  const controller = new AbortController();
  inFlight = controller;
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

  store.setStory("running");
  store.setExploration({ ...IDLE_EXPLORATION, status: "running" });

  // A box, not a `let`: the assignment happens inside a callback.
  const latest: { progress: ExplorationProgress | null } = { progress: null };
  let summary: ExplorationSummary;
  try {
    summary = await runner({
      scenarioId,
      seed,
      replications,
      tickMs: options.tickMs,
      signal: controller.signal,
      onProgress: (progress) => {
        latest.progress = progress;
        useWorkshopStore.getState().setExploration(progress);
      },
    });
  } catch (error) {
    if (isExplorationAborted(error) || controller.signal.aborted) {
      return { ...finish(log), summary: null, cancelled: true };
    }
    throw error;
  } finally {
    if (inFlight === controller) inFlight = null;
  }
  if (controller.signal.aborted) {
    return { ...finish(log), summary: null, cancelled: true };
  }

  if (recordCommand) {
    // TODO(engine): once `explore_schedules` exists this is the source of
    // truth; the runner above only drives the animation.
    const result = step(log, "explore_schedules", { scenarioId, seed, replications }, "agent");
    if (result.ok) summary = result.data as ExplorationSummary;
  }

  const done: ExplorationProgress = {
    status: "done",
    runsExecuted: summary.runsExecuted,
    runsPlanned: Math.max(summary.runsExecuted, latest.progress?.runsPlanned ?? 0),
    rows: latest.progress?.rows ?? [],
    best: summary.best,
  };
  useWorkshopStore.getState().setExploration(done);
  return { ...finish(log), summary, cancelled: false };
}

/* ------------------------------------------------------------ beat 4: proposal */

/** The winning candidate, as the plan the proposal card works with. */
export function proposedPlan(state: Pick<WorkshopStore, "exploration">): Plan | null {
  return state.exploration.best ? planFromCandidate(state.exploration.best) : null;
}

/** Puts the proposal on screen. No world change: the plan is not applied yet. */
export function proposal(plan?: Plan): StoryProposalResult {
  const store = useWorkshopStore.getState();
  const chosen = plan ?? proposedPlan(store);
  store.setStory("proposal");
  return { ...finish([]), plan: chosen };
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
 * Branch off the baseline, apply the plan, re-run the shift and post the note.
 * Defaults to `human`: on the button path it really is the person applying it.
 */
export function applyAndNotify(
  plan?: Plan,
  noteText: string = DEFAULT_NOTE_TEXT,
  options: ApplyOptions = {},
): StoryStepResult {
  const actor = options.actor ?? "human";
  const log: StoryCommandLog[] = [];
  const store = useWorkshopStore.getState();
  const chosen = plan ?? proposedPlan(store);

  if (!chosen) {
    log.push({
      name: "apply_plan",
      input: null,
      ok: false,
      error: "No plan to apply — run the exploration first.",
    });
    return finish(log);
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
  }

  if (hasCommand("apply_plan")) {
    step(log, "apply_plan", { plan: chosen, planId: chosen.id }, actor);
  } else {
    // TODO(engine): collapses into the single `apply_plan` call above once it
    // lands. A PlanChange *is* a command call, so this applies the same plan
    // through the same validated, attributed path.
    for (const change of chosen.changes) {
      step(log, change.command, planChangeInput(change), actor);
    }
  }

  step(log, "run_simulation", {}, actor);
  step(
    log,
    "post_shift_note",
    {
      text: noteText,
      channels: options.channels ?? NOTE_CHANNELS,
      recipients: options.recipients ?? NOTE_RECIPIENTS,
    },
    actor,
  );
  useWorkshopStore.getState().setStory("resolved");
  return finish(log);
}

/* ---------------------------------------------------------------- reset */

/**
 * Back to the calm shop for another take: a fresh world plus the view state
 * that belongs to the story. The WebMCP link and the viewport preset survive —
 * they describe the room, not the story.
 */
export function reset(): void {
  useWorkshopStore.setState({
    ...createInitialState({ story: "calm" }),
    selection: null,
    playbackMinute: null,
    agentAttention: null,
    lastResult: null,
    view: "board",
    story: "calm",
    exploration: IDLE_EXPLORATION,
    popover: null,
  });
  cancelExploration();
}

/* ---------------------------------------------------------------- hooks */

export function useStory(): StoryState {
  return useWorkshopStore((s) => s.story);
}

export function useExploration(): ExplorationProgress {
  return useWorkshopStore((s) => s.exploration);
}

/** The plan the proposal and resolved cards describe. */
export function useProposedPlan(): Plan | null {
  const best = useWorkshopStore((s) => s.exploration.best);
  return useMemo(() => (best ? planFromCandidate(best) : null), [best]);
}

/** Newest shift note, or null before one is posted. */
export function useLatestNote(): ShiftNote | null {
  return useWorkshopStore((s) => s.notes[0] ?? null);
}

export interface StoryActions {
  startEscalation: typeof startEscalation;
  startExploration: typeof startExploration;
  proposal: typeof proposal;
  applyAndNotify: typeof applyAndNotify;
  reset: typeof reset;
}

/** Stable references — the beats are module functions, not store state. */
export const STORY_ACTIONS: StoryActions = {
  startEscalation,
  startExploration,
  proposal,
  applyAndNotify,
  reset,
};

export function useStoryActions(): StoryActions {
  return STORY_ACTIONS;
}
