# `src/commands`

The one command boundary. Every mutation of the world — human click, agent tool call, or demo
control — goes through `executeCommand` here; there is no second write path.

- `registry.ts` — command definitions: zod input schemas, actor-attributed execution, bounded
  structured results, and the agent briefing. WebMCP tools are these same commands with the
  actor pinned to `agent`; three commands (`inject_event`, `activate_scenario`, `reset_demo`)
  are human/demo-only and never registered with WebMCP.

Every mutation records `changeId`, actor (`human` / `agent` / `simulation`), and a concise
before/after summary, which is what makes shared human+agent operation auditable on screen.
