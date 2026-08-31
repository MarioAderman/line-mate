"use client";

/**
 * Canonical client state.
 *
 * The store is a thin Zustand shell around `WorkshopState`: it holds the
 * world and hands the command layer a `CommandContext`. It exposes no
 * setters of its own for world data — `run()` is the only way in — which is
 * how the human UI and the WebMCP agent stay on exactly the same rails.
 * The few extra fields (selection, playback, MCP link status) are view
 * state, not a second model of the world.
 */
import { useMemo } from "react";
import { create } from "zustand";
import type {
  Actor,
  ExplorationProgress,
  ExplorationSummary,
  Plan,
  PlanChange,
  Scenario,
  Selection,
  StoryState,
  View,
} from "@/domain";
import { canTransition } from "@/domain";
import { planFromCandidate } from "@/simulation";
import {
  createInitialState,
  executeCommand,
  type CommandContext,
  type CommandResult,
  type WorkshopState,
} from "@/commands";
import type { SimulationResult } from "@/simulation";

export type McpStatus = "detecting" | "linked" | "unsupported" | "error";

/** Anchored, ephemeral detail shown on hover/click of any floor component. */
export interface Popover {
  target: Selection;
  /** Viewport px, where the popover should anchor. */
  x: number;
  y: number;
}

/** The two real ChatGPT-desktop browser panes we design for. */
export type ViewportPreset = "laptop" | "monitor";
export const VIEWPORTS: Record<ViewportPreset, { width: number; height: number }> = {
  laptop: { width: 1160, height: 865 },
  monitor: { width: 1567, height: 995 },
};

export const IDLE_EXPLORATION: ExplorationProgress = {
  status: "idle",
  runsExecuted: 0,
  runsPlanned: 0,
  rows: [],
  best: null,
};

export interface WorkshopStore extends WorkshopState {
  /** Entity shown in the inspector. */
  selection: Selection | null;
  /** Minute of day the floor is rendering; null = the scenario's "now". */
  playbackMinute: number | null;
  /** Last entity the agent inspected — lets the floor show where it looked. */
  agentAttention: Selection | null;
  mcpStatus: McpStatus;
  mcpToolCount: number;
  lastResult: CommandResult | null;
  /** Board (opening view) or Floor (isometric). View state, not world state. */
  view: View;
  /** Which demo beat the screen is presenting. Transitions follow STORY_TRANSITIONS. */
  story: StoryState;
  /** Progress of the running `explore_schedules` call, for the scenarios panel. */
  exploration: ExplorationProgress;
  popover: Popover | null;
  viewport: ViewportPreset;
  /** Beat 4's unapplied proposal. A plan on screen is not a plan in the world. */
  draft: Plan | null;
  /** Work items the human retargeted inside the draft — attribution on the card. */
  humanEdited: string[];
  /** Work items the agent retargeted inside the draft, via WebMCP. */
  agentEdited: string[];
  /** The scenario the draft proposes changes for — set when the draft lands. */
  draftScenarioId: string | null;
  /** Why the last apply was refused — null when the plan has not been tried. */
  applyError: string | null;
  /** SHEET 0: the cover shown on a fresh load, dismissed once per visit. */
  cover: boolean;

  run(name: string, input?: unknown, actor?: Actor): CommandResult;
  select(selection: Selection | null): void;
  setPlaybackMinute(minute: number | null): void;
  setMcpStatus(status: McpStatus, toolCount?: number): void;
  setView(view: View): void;
  /** Returns false (and does nothing) when the transition is not allowed. */
  setStory(story: StoryState): boolean;
  setExploration(progress: ExplorationProgress): void;
  setPopover(popover: Popover | null): void;
  setViewport(viewport: ViewportPreset): void;
  dismissCover(): void;
  setDraft(plan: Plan | null): void;
  /** Retargets a job inside the draft. No scenario is touched. */
  routeInDraft(workItemId: string, resourceId: string | null, position?: number | null): void;
  setApplyError(error: string | null): void;
  clearDraft(): void;
}

/** View state a demo reset puts back to the opening frame. */
export const RESET_VIEW = {
  selection: null,
  playbackMinute: null,
  agentAttention: null,
  view: "board",
  story: "calm",
  exploration: IDLE_EXPLORATION,
  popover: null,
  draft: null,
  humanEdited: [],
  agentEdited: [],
  draftScenarioId: null,
  applyError: null,
  // A demo reset never re-opens the cover: takes restart on the board.
  cover: false,
} satisfies Partial<WorkshopStore>;

/** Frames per second-ish pacing when an agent-run search is replayed. */
/** ~36 trace frames x 280ms ≈ 10s, matching STORY_TICK_MS on the human path. */
const REPLAY_FRAME_MS = 280;
let replayToken = 0;

export const useWorkshopStore = create<WorkshopStore>((set, get) => ({
  // The demo opens on the calm shop; the escalation is injected live.
  ...createInitialState({ story: "calm" }),
  selection: null,
  playbackMinute: null,
  agentAttention: null,
  mcpStatus: "detecting",
  mcpToolCount: 0,
  lastResult: null,
  view: "board",
  story: "calm",
  exploration: IDLE_EXPLORATION,
  popover: null,
  viewport: "laptop",
  draft: null,
  humanEdited: [],
  agentEdited: [],
  draftScenarioId: null,
  applyError: null,
  cover: true,

  run: (name, input = {}, actor: Actor = "human") => {
    // While the proposal is on screen, an agent retarget of the active
    // scenario edits the visible draft — the same gesture as the human's
    // drag, attributed to the agent — and the world stays untouched until
    // Apply. An explicit different scenarioId keeps normal world semantics.
    if (actor === "agent" && name === "route_work_item" && get().story === "proposal") {
      const raw = (input ?? {}) as {
        workItemId?: string;
        resourceId?: string | null;
        position?: number | null;
        scenarioId?: string;
      };
      const state = get();
      // Anchor on the scenario the draft PROPOSES for, not on whatever is
      // active: live test 4 showed the agent activating its own branch and
      // then routing it — that must stay a world mutation, or its experiment
      // silently becomes a draft edit (it did, twice).
      const target = raw.scenarioId ?? state.activeScenarioId;
      if (target === state.draftScenarioId && state.draft && raw.workItemId) {
        const patch = draftRoutePatch(
          state,
          raw.workItemId,
          raw.resourceId ?? null,
          raw.position,
          "agent",
        );
        if (patch) {
          set(patch);
          const result: CommandResult = {
            ok: true,
            command: name,
            actor,
            data: {
              draftEdited: true,
              workItemId: raw.workItemId,
              route: {
                resourceId: raw.resourceId ?? null,
                position: raw.resourceId === null ? null : (raw.position ?? 1),
              },
              summary:
                "Updated the proposed-plan draft on the manager's screen. " +
                "Nothing is applied to the world until the manager presses Apply & notify team.",
            },
          };
          set({ lastResult: result });
          return result;
        }
      }
    }
    const ctx: CommandContext = {
      getState: () => get(),
      // Spreading keeps the store's own actions while the command layer swaps
      // the world fields it owns.
      setState: (updater) => set((state) => ({ ...state, ...updater(state) })),
      now: () => Date.now(),
      actor,
    };
    let result = executeCommand(ctx, name, input);
    // The draft is view state the command layer cannot see; the agent still
    // needs it to reason about the on-screen proposal and its authorship.
    if (result.ok && name === "inspect_system") {
      const draftBlock = describeDraft(get());
      if (draftBlock) {
        result = { ...result, data: { ...(result.data as object), draft: draftBlock } };
      }
    }
    const patch: Partial<WorkshopStore> = { lastResult: result };
    if (actor === "agent" && result.ok) {
      const raw = (input ?? {}) as { resourceId?: string; workItemId?: string };
      if (name === "inspect_resource" && raw.resourceId) {
        patch.agentAttention = { kind: "resource", id: raw.resourceId };
      } else if (name === "inspect_work_item" && raw.workItemId) {
        patch.agentAttention = { kind: "workItem", id: raw.workItemId };
      }
    }
    set(patch);
    if (result.ok) advanceStoryAfterCommand(name, input, result.data, get, set);
    return result;
  },
  select: (selection) => set({ selection }),
  setPlaybackMinute: (playbackMinute) => set({ playbackMinute }),
  setView: (view) => set({ view, popover: null }),
  setStory: (story) => {
    const current = get().story;
    if (story !== current && !canTransition(current, story)) return false;
    set({ story });
    return true;
  },
  setExploration: (exploration) => set({ exploration }),
  setPopover: (popover) => set({ popover }),
  setViewport: (viewport) => set({ viewport }),
  setMcpStatus: (mcpStatus, toolCount) =>
    set((state) => ({ mcpStatus, mcpToolCount: toolCount ?? state.mcpToolCount })),
  setDraft: (draft) =>
    set({
      draft,
      draftScenarioId: draft ? get().activeScenarioId : null,
      humanEdited: [],
      agentEdited: [],
      applyError: null,
    }),
  setApplyError: (applyError) => set({ applyError }),
  dismissCover: () => set({ cover: false }),
  clearDraft: () =>
    set({ draft: null, draftScenarioId: null, humanEdited: [], agentEdited: [], applyError: null }),
  routeInDraft: (workItemId, resourceId, position = 1) =>
    set((state) => draftRoutePatch(state, workItemId, resourceId, position, "human") ?? state),
}));

/**
 * One retarget inside the draft, for either editor. Returns the store patch,
 * or null when there is no draft to edit. Attribution lands on the matching
 * edited-list so the card can say whose change it is.
 */
function draftRoutePatch(
  state: WorkshopStore,
  workItemId: string,
  resourceId: string | null,
  position: number | null | undefined,
  editor: "human" | "agent",
): Partial<WorkshopStore> | null {
  if (!state.draft) return null;
  const change: PlanChange = {
    command: "route_work_item",
    workItemId,
    resourceId,
    // A released route has no queue; the schema enforces the same rule.
    position: resourceId === null ? null : (position ?? 1),
  };
  const existing = state.draft.changes.findIndex(
    (c) => c.command === "route_work_item" && c.workItemId === workItemId,
  );
  const changes =
    existing === -1
      ? [...state.draft.changes, change]
      : state.draft.changes.map((c, i) => (i === existing ? change : c));
  const list = editor === "human" ? state.humanEdited : state.agentEdited;
  const edited = list.includes(workItemId) ? list : [...list, workItemId];
  return {
    draft: { ...state.draft, changes },
    applyError: null,
    ...(editor === "human" ? { humanEdited: edited } : { agentEdited: edited }),
  };
}

/**
 * The on-screen draft, shaped for the agent: which choices the proposal is
 * standing on right now and who set each one. Null outside the proposal beat.
 */
function describeDraft(state: WorkshopStore): Record<string, unknown> | null {
  if (!state.draft || state.story !== "proposal") return null;
  const best = state.exploration.best;
  return {
    planId: state.draft.id,
    label: state.draft.label,
    scenarioId: state.draftScenarioId,
    status:
      "Unapplied draft on the manager's screen — it becomes real only when " +
      "the manager presses Apply & notify team.",
    expected: best
      ? {
          promisesMet: best.promisesMet,
          promisedTotal: best.promisedTotal,
          promisesMetRate: best.promisesMetRate,
        }
      : null,
    changes: state.draft.changes.map((change) => ({
      ...change,
      editedBy: state.humanEdited.includes(change.workItemId)
        ? "human"
        : state.agentEdited.includes(change.workItemId)
          ? "agent"
          : "agent-proposal",
    })),
  };
}

/* ----------------------------------------- story lifecycle from commands */

type Get = () => WorkshopStore;
type Set = (partial: Partial<WorkshopStore>) => void;

function applyStory(to: StoryState, get: Get, set: Set): boolean {
  const current = get().story;
  if (to !== current && !canTransition(current, to)) return false;
  set({ story: to });
  return true;
}

function doneFrame(summary: ExplorationSummary): ExplorationProgress {
  return {
    status: "done",
    runsExecuted: summary.runsExecuted,
    runsPlanned: summary.runsExecuted,
    rows: summary.top.map((c) => ({
      id: c.id,
      label: c.label,
      progress: 1,
      promisesMet: c.promisesMet,
      promisesMetRate: c.promisesMetRate,
    })),
    best: summary.best,
  };
}

/**
 * The story the SCREEN shows must follow the world no matter who moved it —
 * the UI beats or the external WebMCP agent (finding 2). The storySlice path
 * drives its own presentation and marks its search with `includeTrace`, so
 * this only auto-drives the calls that did not come from the slice. Every
 * move goes through the same transition guard the UI uses; an illegal beat is
 * simply not taken.
 */
function advanceStoryAfterCommand(
  name: string,
  input: unknown,
  data: unknown,
  get: Get,
  set: Set,
): void {
  const payload = (input ?? {}) as { includeTrace?: boolean; plan?: Plan };

  if (name === "reset_demo") {
    replayToken += 1;
    set(RESET_VIEW);
    return;
  }

  if (name === "inject_event") {
    applyStory("escalation", get, set);
    return;
  }

  // Every agent search animates: the command always carries its measured
  // trace, so the replay no longer depends on the agent asking for it (live
  // test 2: Codex naturally sends includeTrace:false). The story slice's own
  // human path sets story to "running" before it runs and replays frames
  // itself — the guard keeps this interception off that path.
  if (name === "explore_schedules" && get().story !== "running") {
    const summary = data as ExplorationSummary & { trace?: ExplorationProgress[] };
    applyStory("running", get, set);
    const finish = () => {
      set({ exploration: doneFrame(summary) });
      if (applyStory("proposal", get, set) && summary.best && !get().draft) {
        set({
          draft: planFromCandidate(summary.best),
          draftScenarioId: get().activeScenarioId,
          humanEdited: [],
          agentEdited: [],
          applyError: null,
        });
      }
    };
    const trace = summary.trace ?? [];
    if (typeof window === "undefined" || trace.length === 0) {
      finish();
      return;
    }
    // Replay the one search's own frames; a newer run or a reset cancels it.
    replayToken += 1;
    const token = replayToken;
    set({ exploration: { ...IDLE_EXPLORATION, status: "running" } });
    trace.forEach((frame, index) => {
      window.setTimeout(() => {
        if (replayToken === token) set({ exploration: frame });
      }, REPLAY_FRAME_MS * (index + 1));
    });
    window.setTimeout(
      () => {
        if (replayToken === token) finish();
      },
      REPLAY_FRAME_MS * (trace.length + 1),
    );
    return;
  }

  if (name === "apply_plan") {
    if (!get().draft && payload.plan) {
      set({
        draft: structuredClone(payload.plan),
        draftScenarioId:
          (payload as { scenarioId?: string }).scenarioId ?? get().activeScenarioId,
        applyError: null,
      });
    }
    return;
  }

  if (name === "post_shift_note") {
    const state = get();
    if (state.story !== "proposal") return;
    const totals = state.simulations[state.activeScenarioId]?.totals;
    const note = (data as { note?: { id: string; scenarioId: string } }).note;
    const stored =
      note && state.notes.some((n) => n.id === note.id && n.scenarioId === state.activeScenarioId);
    if (totals && totals.promisesMet === totals.promisedTotal && stored) {
      applyStory("resolved", get, set);
    }
  }
}

/** Non-reactive access, for effects and the WebMCP adapter. */
export function runCommand(name: string, input?: unknown, actor: Actor = "agent"): CommandResult {
  return useWorkshopStore.getState().run(name, input, actor);
}

/* ------------------------------------------------------------- selectors */

export function selectActiveScenario(state: WorkshopStore): Scenario {
  return state.scenarios.find((s) => s.id === state.activeScenarioId) ?? state.scenarios[0];
}

export function selectActiveSimulation(state: WorkshopStore): SimulationResult | null {
  return state.simulations[state.activeScenarioId] ?? null;
}

export function useActiveScenario(): Scenario {
  return useWorkshopStore(selectActiveScenario);
}

export function useActiveSimulation(): SimulationResult | null {
  return useWorkshopStore(selectActiveSimulation);
}

export interface ScenarioCard {
  id: string;
  name: string;
  parentId: string | null;
  simulated: boolean;
  promisesMet: number | null;
  promisedTotal: number;
  active: boolean;
}

export function useScenarioCards(): ScenarioCard[] {
  // Select stable references and derive in React: a selector that maps to
  // fresh objects would never be equal and would re-render forever.
  const scenarios = useWorkshopStore((s) => s.scenarios);
  const simulations = useWorkshopStore((s) => s.simulations);
  const activeScenarioId = useWorkshopStore((s) => s.activeScenarioId);
  return useMemo(
    () =>
      scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        parentId: s.parentId,
        simulated: Boolean(simulations[s.id]),
        promisesMet: simulations[s.id]?.totals.promisesMet ?? null,
        promisedTotal: s.workItems.filter((w) => w.dueMinute !== null).length,
        active: s.id === activeScenarioId,
      })),
    [scenarios, simulations, activeScenarioId],
  );
}
