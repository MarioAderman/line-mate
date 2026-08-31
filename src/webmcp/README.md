# `src/webmcp`

The bridge to the experimental WebMCP browser API — and nothing else. Registration lifecycle,
feature detection, serialization; all churn from the evolving spec stays inside this folder.

- `adapter.ts` — feature-detects `document.modelContext` (the deprecated
  `navigator.modelContext` is deliberately ignored), registers tools, cleans up with an
  `AbortController`.
- `tools.ts` — maps the command registry to WebMCP tool descriptors (13-name allowlist,
  `readOnlyHint` annotations, JSON schemas from zod) and bounds responses — e.g. the
  exploration's animation trace is stripped unless the caller asks for it.
- `WebMcpBridge.tsx` — the mount point; shows up in the header pill as
  `Agent linked · 13 tools` when a capable browser is attached.
