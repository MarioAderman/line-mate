# Operational Simulation Lab

A WebMCP-native workshop simulation for the 2026 WebMCP Challenge. A human manager and an
external browser agent inspect the same operational state, test recovery scenarios, and continue
from one another's changes.

The working product name is intentionally undecided. See `docs/demo-scenario.md` for the vertical
slice and `docs/architecture.md` for the frozen v0.1 boundaries.

## Local development

```bash
npm install
npm run dev
```

Before handing off work:

```bash
npm run verify
```

## Agent collaboration

This repo is prepared for Codex and Claude Code running in Herdr. Read `CLAUDE.md`, then
`docs/coordination.md`, before delegating or starting a parallel implementation stream.

