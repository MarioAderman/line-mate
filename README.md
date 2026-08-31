# Line-Mate

**One more technician on the line.** Line-Mate is a WebMCP-native shop floor where a human
manager and a browser agent run the same operation, live — the agent explores real recovery
plans, the manager keeps authority. Built for the 2026 WebMCP Challenge.

> 🚗 **Live PWA:** https://line-mate.vercel.app
> 🎬 **Demo video:** _coming soon_ <!-- TODO: video link after recording -->

## What this is

A mid-market auto repair shop, Friday 14:15, six customer promises before closing. A water-pump
delay blocks Bay 3 and puts two promises at risk. The manager and an external agent — ChatGPT /
Codex through the experimental [WebMCP](https://github.com/webmachinelearning/webmcp) browser API —
recover the schedule **together, on the same live world**:

1. **Calm** — the shift board shows 6/6 promises on plan.
2. **Escalation** — the part delay lands: Bay 3 blocked, 4/6, two cars in red.
3. **Exploration** — the agent searches 141 alternative schedules across thousands of seeded
   simulation runs; the screen animates the search as it happens.
4. **Proposal** — the winning plan appears as draggable cards. The manager can retarget any car;
   the agent can move the same dropdowns through tools. Every change carries its author.
5. **Resolved** — apply & notify: 6/6 recovered, shift note logged with its channels.

This is not "AI added to a simulator". The thesis is **shared operation**: one world, one command
boundary, visible attribution (`human` / `agent` / `simulation`), a protected baseline, and
scenario branches so the agent can experiment without touching the plan of record.

## Why it's honest

- **Deterministic engine.** Pure TypeScript discrete-event simulation in the browser. Same seed,
  same numbers — every run, every machine.
- **Measured confidence.** The exploration scores every candidate across seeded replications and
  reports how often a plan holds. No hardcoded percentages anywhere.
- **Nothing is applied silently.** The proposal is a draft on screen until the manager applies it.
  Notifications are recorded in the shop log; the page performs no external delivery.

## WebMCP surface

The page registers **13 tools** via `document.modelContext` (Imperative API, feature-detected):

| Kind | Tools |
|---|---|
| Read | `inspect_system` (includes the agent briefing and the on-screen draft), `inspect_resource`, `inspect_work_item`, `get_simulation_results`, `compare_scenarios` |
| Mutation | `create_scenario`, `update_resource`, `update_work_item`, `route_work_item`, `apply_plan`, `post_shift_note` |
| Action | `run_simulation`, `explore_schedules` |

Human-only demo controls (`inject_event`, `activate_scenario`, `reset_demo`) are **not** exposed
to agents. Tool responses are structured, validated with zod, and bounded. During the proposal
beat, an agent `route_work_item` on the draft's scenario edits the visible draft — dropdown moves,
`agent change` badge — and the world stays untouched until the manager applies.

## Try it

```bash
npm install
npm run dev        # http://localhost:3000
```

- **Views:** `Board | Floor` switch in the header (shift board / isometric shop).
- **Demo story:** `Shift+E` part delay · `Shift+R` explore & propose · `Shift+A` apply & notify ·
  `Shift+0` reset.
- **With an agent:** open the page in a WebMCP-capable surface — ChatGPT desktop app's built-in
  browser / Codex, or Chrome with `chrome://flags/#enable-webmcp-testing` (DevTools gains a WebMCP
  panel to inspect and invoke the tools directly). The header pill shows `Agent linked · 13 tools`
  when the bridge is up.

## Architecture

```text
human UI ─┐
          ├─> application commands ─> canonical Zustand store ─> simulation engine
WebMCP ───┘                                      │
                                                 └─> visible change history
```

- `src/domain` — canonical serializable types, fixtures, disruptions
- `src/simulation` — deterministic engine + seeded schedule exploration (no React)
- `src/commands` — the one command boundary; UI and agents call the same commands
- `src/store` — the single live world state + story/view state
- `src/webmcp` — registration lifecycle, schemas, serialization, feature detection
- `src/components` — shift board, isometric floor, story panels (S1 "Blueprint" design language)

Stack: Next.js (App Router) · React · TypeScript · Tailwind · Zustand · Motion · zod. Fully
client-side; the deployment target only serves static assets.

## Development

```bash
npm run verify     # typecheck + lint + tests + build — the quality gate
npm test
```

Each `src/` subdirectory carries its own README, and `docs/` holds the architecture,
simulation-model, WebMCP tool contract, design-system, and demo-scenario references.

Built for the 2026 WebMCP Challenge by Mario Aderman with Claude Code and Codex working as
parallel agent sessions on the same repository.
