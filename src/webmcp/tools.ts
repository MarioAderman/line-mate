/**
 * Command registry -> WebMCP tool descriptors.
 *
 * There is no second implementation of anything here: a tool is a command,
 * its input schema is the command's zod schema, and its handler is
 * `executeCommand` with the actor pinned to "agent" so every mutation lands
 * in the activity strip attributed correctly.
 */
import { z } from "zod";
import { COMMANDS, type CommandResult } from "@/commands";
import type { WebMcpTool, WebMcpToolResult } from "./types";

/**
 * The agent-facing surface (docs/webmcp-tools.md). A subset of the command
 * registry on purpose: `activate_scenario` only moves the human's own view.
 */
export const WEBMCP_TOOL_NAMES = [
  "inspect_system",
  "inspect_resource",
  "inspect_work_item",
  "get_simulation_results",
  "compare_scenarios",
  "create_scenario",
  "update_resource",
  "update_work_item",
  "route_work_item",
  "run_simulation",
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

/** Zod -> JSON Schema, with a permissive fallback if conversion ever fails. */
function toInputSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  } catch {
    return { type: "object", additionalProperties: true };
  }
}

export function formatResult(result: CommandResult): WebMcpToolResult {
  if (!result.ok) {
    return {
      content: [{ type: "text", text: `${result.command} failed: ${result.error}` }],
      isError: true,
    };
  }
  return { content: [{ type: "text", text: JSON.stringify(result.data) }] };
}

export type CommandRunner = (name: string, input: unknown) => CommandResult;

export function buildWebMcpTools(run: CommandRunner): WebMcpTool[] {
  const exposed = new Set<string>(WEBMCP_TOOL_NAMES);
  return COMMANDS.filter((command) => exposed.has(command.name)).map((command) => ({
    name: command.name,
    title: command.title,
    description: command.description,
    inputSchema: toInputSchema(command.input),
    annotations: {
      readOnlyHint: command.kind === "read",
      untrustedContentHint: false,
    },
    execute: async (args: unknown) => formatResult(run(command.name, args ?? {})),
  }));
}
