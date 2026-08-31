import { describe, expect, it } from "vitest";
import { BASELINE_SCENARIO_ID } from "@/domain";
import { createMemoryContext } from "./state";
import { executeCommand } from "./registry";

describe("reset_demo", () => {
  it("rebuilds the whole world through the command boundary", () => {
    const ctx = createMemoryContext("human");
    executeCommand(ctx, "create_scenario", { name: "Branch" });
    executeCommand(ctx, "update_work_item", { workItemId: "veh-01", changes: { priority: 1 } });
    executeCommand(ctx, "run_simulation", {});
    expect(ctx.state.scenarios.length).toBeGreaterThan(1);

    const result = executeCommand(ctx, "reset_demo", { story: "calm" });
    expect(result.ok).toBe(true);
    expect(ctx.state.scenarios).toHaveLength(1);
    expect(ctx.state.scenarios[0].id).toBe(BASELINE_SCENARIO_ID);
    expect(ctx.state.scenarios[0].resources.find((r) => r.id === "bay-3")!.status).toBe("idle");
    expect(ctx.state.changes).toHaveLength(1);
    expect(ctx.state.notes).toEqual([]);
    expect(ctx.state.simulations).toEqual({});
  });

  it("defaults to the calm story and can rebuild the escalated one", () => {
    const ctx = createMemoryContext("human");
    executeCommand(ctx, "reset_demo", {});
    expect(ctx.state.scenarios[0].resources.find((r) => r.id === "bay-3")!.status).toBe("idle");
    executeCommand(ctx, "reset_demo", { story: "escalated" });
    expect(ctx.state.scenarios[0].resources.find((r) => r.id === "bay-3")!.status).toBe("blocked");
  });

  it("refuses the agent", () => {
    const ctx = createMemoryContext("agent");
    const result = executeCommand(ctx, "reset_demo", {});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("human demo control");
  });
});
