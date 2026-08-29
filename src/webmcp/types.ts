/**
 * Minimal structural typing for the WebMCP Imperative API.
 *
 * WebMCP is experimental, so nothing here comes from a vendor package: we
 * describe only what we call, feature-detect it at runtime, and degrade to
 * a no-op when the page is opened in a browser without `document.modelContext`.
 */
export interface WebMcpToolResultContent {
  type: "text";
  text: string;
}

export interface WebMcpToolResult {
  content: WebMcpToolResultContent[];
  isError?: boolean;
}

export interface WebMcpToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: WebMcpToolAnnotations;
  execute(args: unknown): Promise<WebMcpToolResult>;
}

export interface WebMcpRegisterOptions {
  signal?: AbortSignal;
}

/** The current producer surface on `document.modelContext`. */
export interface ModelContextHost {
  registerTool(tool: WebMcpTool, options?: WebMcpRegisterOptions): Promise<void>;
}

export type WebMcpLinkStatus = "linked" | "unsupported" | "error";

export interface WebMcpRegistration {
  status: WebMcpLinkStatus;
  toolCount: number;
  toolNames: string[];
  error?: string;
  /** Always safe to call, including when nothing was registered. */
  dispose(): void;
}
