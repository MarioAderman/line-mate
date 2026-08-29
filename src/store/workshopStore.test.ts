import { beforeEach, describe, expect, it } from "vitest";
import { createInitialState } from "@/commands";
import { runCommand, useWorkshopStore } from "./workshopStore";

beforeEach(() => {
  useWorkshopStore.setState({
    ...createInitialState(),
    selection: null,
    playbackMinute: null,
    agentAttention: null,
    lastResult: null,
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
