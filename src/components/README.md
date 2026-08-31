# `src/components`

The S1 "Blueprint" interface: an industrial drafting-sheet language (IBM Plex, ink on paper,
rules and title blocks), not a SaaS dashboard.

- `frame/` — the shell: header with clock and promise counter, Board|Floor switch, agent pill,
  title block, live figures strip.
- `board/` — the shift board: promise strip, bay lanes on the time axis, floor strip.
- `floor/` — the isometric shop: full-custom 2.5D SVG projection (lifts, diagnostics, waiting
  lot, parts apron) with plan-route animation when a proposal is on the table.
- `story/` — the story layer: exploration panel, proposal card with per-change authorship
  badges and draggable route cards, resolved card, hidden keyboard demo controls.
- `vehicles/` — the shared vehicle glyph API (side-view profiles by body kind).
- `derive.ts` — presentation-ready projections derived from the canonical state.
