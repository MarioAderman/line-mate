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
    agentEdited: [],
    applyError: null,
  });
});

describe("agent edits the visible draft during the proposal", () => {
  function reachProposal(): void {
    expect(runCommand("explore_schedules", {}, "agent").ok).toBe(true);
    expect(useWorkshopStore.getState().story).toBe("proposal");
    expect(useWorkshopStore.getState().draft).not.toBeNull();
  }

  it("routes an agent retarget into the draft, not the world", () => {
    reachProposal();
    const state = useWorkshopStore.getState();
    const active = state.scenarios.find((s) => s.id === state.activeScenarioId)!;
    const worldRouteBefore = structuredClone(
      active.workItems.find((w) => w.id === "veh-05")!.route,
    );

    const result = runCommand(
      "route_work_item",
      { workItemId: "veh-05", resourceId: "bay-2" },
      "agent",
    );
    expect(result.ok).toBe(true);
    expect((result as { data: { draftEdited?: boolean } }).data.draftEdited).toBe(true);

    const after = useWorkshopStore.getState();
    expect(after.agentEdited).toContain("veh-05");
    expect(after.humanEdited).not.toContain("veh-05");
    const change = after.draft!.changes.find(
      (c) => c.command === "route_work_item" && c.workItemId === "veh-05",
    );
    expect(change).toMatchObject({ resourceId: "bay-2" });
    // The world is untouched: same route as before, no new change record.
    const activeAfter = after.scenarios.find((s) => s.id === after.activeScenarioId)!;
    expect(activeAfter.workItems.find((w) => w.id === "veh-05")!.route).toEqual(worldRouteBefore);
    expect(after.story).toBe("proposal");
  });

  it("keeps world semantics when the agent targets another scenario", () => {
    reachProposal();
    const created = runCommand(
      "create_scenario",
      { name: "Side branch", activate: false },
      "agent",
    );
    expect(created.ok).toBe(true);
    const branchId = (created as { data: { scenarioId: string } }).data.scenarioId;

    const result = runCommand(
      "route_work_item",
      { workItemId: "veh-05", resourceId: "bay-2", scenarioId: branchId },
      "agent",
    );
    expect(result.ok).toBe(true);
    expect((result as { data: { draftEdited?: boolean } }).data.draftEdited).toBeUndefined();
    expect((result as { data: { changeId?: string } }).data.changeId).toBeDefined();
    expect(useWorkshopStore.getState().agentEdited).not.toContain("veh-05");
  });

  it("inspect_system carries the briefing and the draft with authorship", () => {
    reachProposal();
    useWorkshopStore.getState().routeInDraft("veh-03", "bay-1", 1);
    expect(runCommand("route_work_item", { workItemId: "veh-05", resourceId: "bay-2" }, "agent").ok).toBe(true);

    const result = runCommand("inspect_system", {}, "agent");
    expect(result.ok).toBe(true);
    const data = (result as {
      data: {
        briefing?: string;
        draft?: { changes: Array<{ workItemId: string; editedBy: string }> };
      };
    }).data;
    expect(data.briefing).toContain("branch first");
    expect(data.draft).toBeDefined();
    const byId = new Map(data.draft!.changes.map((c) => [`${c.workItemId}`, c.editedBy]));
    expect(byId.get("veh-03")).toBe("human");
    expect(byId.get("veh-05")).toBe("agent");
    // Everything the search proposed and nobody touched keeps its origin.
    expect(
      data.draft!.changes.some((c) => c.editedBy === "agent-proposal"),
    ).toBe(true);
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

