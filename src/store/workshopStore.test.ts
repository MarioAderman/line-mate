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
    draft: null,
    humanEdited: [],
    applyError: null,
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

describe("finding 2 — the external agent drives the same visible story", () => {
  it("walks Running → Proposal → Resolved from bare WebMCP-style calls", () => {
    // The direct tool path: no includeTrace, no storySlice, agent actor only
    // (plus the human saying yes at the end by the agent applying for them).
    const search = runCommand("explore_schedules", {}, "agent");
    expect(search.ok).toBe(true);
    // The screen followed the world: proposal on the table, draft = the winner.
    expect(useWorkshopStore.getState().story).toBe("proposal");
    expect(useWorkshopStore.getState().exploration.status).toBe("done");
    const draft = useWorkshopStore.getState().draft;
    expect(draft).not.toBeNull();

    expect(runCommand("create_scenario", { name: "Agent recovery" }, "agent").ok).toBe(true);
    expect(runCommand("apply_plan", { plan: draft }, "agent").ok).toBe(true);
    expect(runCommand("run_simulation", {}, "agent").ok).toBe(true);
    expect(
      runCommand(
        "post_shift_note",
        { text: "Recovery applied.", channels: ["slack"], recipients: ["Ana"] },
        "agent",
      ).ok,
    ).toBe(true);
    expect(useWorkshopStore.getState().story).toBe("resolved");
  });

  it("does not resolve on a note when the run misses a promise", () => {
    expect(runCommand("explore_schedules", {}, "agent").ok).toBe(true);
    expect(runCommand("create_scenario", { name: "Weak recovery" }, "agent").ok).toBe(true);
    // No plan applied: the branch still misses two promises.
    expect(runCommand("run_simulation", {}, "agent").ok).toBe(true);
    expect(
      runCommand(
        "post_shift_note",
        { text: "Too early.", channels: ["slack"] },
        "agent",
      ).ok,
    ).toBe(true);
    expect(useWorkshopStore.getState().story).toBe("proposal");
  });

  it("reset_demo snaps the view back to the calm opening frame", () => {
    expect(runCommand("explore_schedules", {}, "agent").ok).toBe(true);
    useWorkshopStore.getState().setMcpStatus("linked", 13);
    const reset = useWorkshopStore.getState().run("reset_demo", { story: "calm" }, "human");
    expect(reset.ok).toBe(true);
    const state = useWorkshopStore.getState();
    expect(state.story).toBe("calm");
    expect(state.draft).toBeNull();
    expect(state.exploration.status).toBe("idle");
    expect(state.mcpStatus).toBe("linked");
  });
});

