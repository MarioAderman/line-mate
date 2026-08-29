import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryContext, executeCommand } from "@/commands";
import { detectModelContext, registerWebMcpTools } from "./adapter";
import { buildWebMcpTools, WEBMCP_TOOL_NAMES } from "./tools";
import type { WebMcpRegisterOptions, WebMcpTool } from "./types";

const globalRef = globalThis as unknown as Record<string, unknown>;

function withDocument(modelContext: unknown): void {
  globalRef.document = { modelContext };
}

afterEach(() => {
  delete globalRef.document;
  delete globalRef.navigator;
});

function runner() {
  const ctx = createMemoryContext("agent");
  return { ctx, run: (name: string, input: unknown) => executeCommand(ctx, name, input) };
}

describe("feature detection", () => {
  it("reports nothing when there is no document (server render)", () => {
    expect(detectModelContext()).toBeNull();
  });

  it("reports unsupported when registration has no document", async () => {
    expect((await registerWebMcpTools(runner().run)).status).toBe("unsupported");
  });

  it("ignores a modelContext that is not a usable host", () => {
    withDocument({ somethingElse: true });
    expect(detectModelContext()).toBeNull();
  });

  it("does not fall back to the deprecated navigator.modelContext", () => {
    globalRef.document = {};
    globalRef.navigator = { modelContext: { registerTool: () => {} } };
    expect(detectModelContext()).toBeNull();
  });

  it("finds document.modelContext when it exposes registerTool", () => {
    withDocument({ registerTool: () => {} });
    expect(detectModelContext()).not.toBeNull();
  });
});

describe("registration", () => {
  it("registers the ten v0.1 tools with current titles and annotations", async () => {
    const registered: WebMcpTool[] = [];
    withDocument({
      registerTool: async (tool: WebMcpTool) => {
        registered.push(tool);
      },
    });

    const registration = await registerWebMcpTools(runner().run);
    expect(registration.status).toBe("linked");
    expect(registration.toolCount).toBe(10);
    expect(registered.map((t) => t.name).sort()).toEqual([...WEBMCP_TOOL_NAMES].sort());

    const readOnly = registered.filter((t) => t.annotations.readOnlyHint).map((t) => t.name).sort();
    expect(readOnly).toEqual(
      ["compare_scenarios", "get_simulation_results", "inspect_resource", "inspect_system", "inspect_work_item"],
    );
    for (const tool of registered) {
      expect(tool.title?.length).toBeGreaterThan(3);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      expect(tool.annotations.untrustedContentHint).toBe(false);
    }
  });

  it("does not expose the human-only view switch", () => {
    const names = buildWebMcpTools(runner().run).map((t) => t.name);
    expect(names).not.toContain("activate_scenario");
  });

  it("hands the host an abort signal and aborts it on dispose", async () => {
    const signals: AbortSignal[] = [];
    withDocument({
      registerTool: async (_tool: WebMcpTool, options?: WebMcpRegisterOptions) => {
        if (options?.signal) signals.push(options.signal);
      },
    });
    const registration = await registerWebMcpTools(runner().run);
    expect(signals).toHaveLength(10);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    registration.dispose();
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("does not accept the removed provideContext-only surface", () => {
    withDocument({ provideContext: vi.fn() });
    expect(detectModelContext()).toBeNull();
  });

  it("awaits and surfaces registration rejections", async () => {
    withDocument({
      registerTool: async () => {
        throw new Error("host exploded");
      },
    });
    const registration = await registerWebMcpTools(runner().run);
    expect(registration.status).toBe("error");
    expect(registration.error).toContain("host exploded");
    expect(() => registration.dispose()).not.toThrow();
  });
});

describe("tool execution", () => {
  it("returns command output as JSON text", async () => {
    const { run, ctx } = runner();
    const inspect = buildWebMcpTools(run).find((t) => t.name === "inspect_system")!;
    const result = await inspect.execute({});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).scenario.id).toBe(ctx.state.activeScenarioId);
  });

  it("marks validation failures as tool errors", async () => {
    const update = buildWebMcpTools(runner().run).find((t) => t.name === "update_resource")!;
    const result = await update.execute({ resourceId: "bay-1", changes: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("update_resource failed");
  });

  it("protects the baseline from the agent", async () => {
    const tools = buildWebMcpTools(runner().run);
    const route = tools.find((t) => t.name === "route_work_item")!;
    const result = await route.execute({ workItemId: "veh-05", resourceId: null });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("create_scenario");
  });

  it("attributes agent tool calls in the change history", async () => {
    const { run, ctx } = runner();
    const tools = buildWebMcpTools(run);
    await tools.find((t) => t.name === "run_simulation")!.execute({});
    expect(ctx.state.changes[0].actor).toBe("agent");
  });
});
