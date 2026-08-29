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
  Scenario,
  Selection,
  StoryState,
  View,
} from "@/domain";
import { canTransition } from "@/domain";
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
}

export const useWorkshopStore = create<WorkshopStore>((set, get) => ({
  ...createInitialState(),
  selection: null,
  playbackMinute: null,
  agentAttention: null,
  mcpStatus: "detecting",
  mcpToolCount: 0,
  lastResult: null,
  view: "board",
  story: "escalation",
  exploration: IDLE_EXPLORATION,
  popover: null,
  viewport: "laptop",

  run: (name, input = {}, actor: Actor = "human") => {
    const ctx: CommandContext = {
      getState: () => get(),
      // Spreading keeps the store's own actions while the command layer swaps
      // the world fields it owns.
      setState: (updater) => set((state) => ({ ...state, ...updater(state) })),
      now: () => Date.now(),
      actor,
    };
    const result = executeCommand(ctx, name, input);
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
}));

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
