/**
 * Isolated `document.modelContext` adapter.
 *
 * Everything that touches the browser's model-context surface lives in this
 * module. It is safe to import anywhere: on the server, or in a browser with
 * no WebMCP support, `registerWebMcpTools` returns an "unsupported"
 * registration and touches nothing. Registration is tied to an
 * `AbortController`, so tearing the page down cancels every tool at once.
 */
import type { ModelContextHost, WebMcpRegistration } from "./types";
import { buildWebMcpTools, type CommandRunner } from "./tools";

function looksLikeHost(value: unknown): value is ModelContextHost {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as ModelContextHost;
  return typeof candidate.registerTool === "function";
}

/**
 * Only `document.modelContext` is supported. `navigator.modelContext` is the
 * deprecated spelling and is deliberately not probed (CLAUDE.md gotchas).
 */
export function detectModelContext(): ModelContextHost | null {
  if (typeof document === "undefined") return null;
  const candidate = (document as unknown as { modelContext?: unknown }).modelContext;
  return looksLikeHost(candidate) ? candidate : null;
}

export function isWebMcpAvailable(): boolean {
  return detectModelContext() !== null;
}

const unsupported: WebMcpRegistration = {
  status: "unsupported",
  toolCount: 0,
  toolNames: [],
  dispose: () => {},
};

/**
 * Registers every agent-facing command as a WebMCP tool. Returns a
 * registration whose `dispose()` is always safe to call.
 */
export async function registerWebMcpTools(
  run: CommandRunner,
): Promise<WebMcpRegistration> {
  const host = detectModelContext();
  if (!host) return unsupported;

  const tools = buildWebMcpTools(run);
  const controller = new AbortController();

  try {
    await Promise.all(
      tools.map((tool) => host.registerTool(tool, { signal: controller.signal })),
    );
    return {
      status: "linked",
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      dispose: () => controller.abort(),
    };
  } catch (error) {
    controller.abort();
    return {
      ...unsupported,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
