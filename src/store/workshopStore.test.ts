import { beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "@/commands";
import { IDLE_EXPLORATION, runCommand, useWorkshopStore } from "./workshopStore";

beforeEach(() => {
  useWorkshopStore.setState({
    ...createInitialState(),
    selection: null,
    playbackMinute: null,
    agentAttention: null,
    lastResult: null,
    view: "board",
    story: "escalation",
    exploration: IDLE_EXPLORATION,
    popover: null,
  });
});

describe("workshop store", () => {
  it("routes every mutation through the command layer with its actor", () => {
    const result = useWorkshopStore.getState().run("run_simulation", {}, "human");
    expect(result.ok).toBe(true);
    const state = useWorkshopStore.getState();
    expect(state.changes[0]).toMatchObject({ actor: "human", command: "run_simulation" });
    expect(state.simulations[state.activeScenarioId]).toBeDefined();
  });

  it("defaults non-reactive callers to the agent and records attention", () => {
    runCommand("inspect_resource", { resourceId: "bay-3" });
    expect(useWorkshopStore.getState().agentAttention).toEqual({ kind: "resource", id: "bay-3" });
  });

  it("keeps view state out of the world", () => {
    useWorkshopStore.getState().select({ kind: "workItem", id: "veh-01" });
    useWorkshopStore.getState().setPlaybackMinute(900);
    const state = useWorkshopStore.getState();
    expect(state.selection).toEqual({ kind: "workItem", id: "veh-01" });
    expect(state.playbackMinute).toBe(900);
    expect(state.changes).toHaveLength(1);
  });
});

describe("view state", () => {
  it("opens on the Board and switches to the Floor without touching the world", () => {
    expect(useWorkshopStore.getState().view).toBe("board");
    useWorkshopStore.getState().setView("floor");
    expect(useWorkshopStore.getState().view).toBe("floor");
    expect(useWorkshopStore.getState().changes).toHaveLength(1);
  });

  it("only allows story transitions in the scripted order", () => {
    const s = useWorkshopStore.getState();
    expect(s.setStory("resolved")).toBe(false);
    expect(useWorkshopStore.getState().story).toBe("escalation");
    expect(s.setStory("running")).toBe(true);
    expect(useWorkshopStore.getState().setStory("proposal")).toBe(true);
    expect(useWorkshopStore.getState().setStory("resolved")).toBe(true);
    expect(useWorkshopStore.getState().setStory("calm")).toBe(true);
  });
});

