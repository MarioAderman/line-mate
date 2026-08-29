# Design direction v0.2 — S1 Blueprint

Status: **frozen and re-confirmed for implementation** on 2026-08-29.

Authoritative private canvas:
`https://claude.ai/code/artifact/d14699c0-6d54-4d12-aa5d-a083a6a81a77`, version
`FROZEN-reconfirmed-S1`. Page 1 defines composition and interaction; page 2 option S1 defines the
graphic language. Page 3 and the older Annunciator/Blueprint/Traffic artifact are reference-only.

## Subject and job

Audience: workshop managers and industrial engineers. The screen must make the shift plan, a
production risk, its operational cause, scenario exploration, the proposed recovery, the human
adjustment, and the resulting 6/6 plan understandable without a tutorial.

The app is the primary visual surface. ChatGPT is the external conversational surface through
WebMCP; there is no in-app chat.

## S1 Blueprint graphic language

The PWA reads like a disciplined engineering drawing rather than a dark control-room dashboard.
The drafting grammar is functional, not decorative: the schedule is the drawing field, durations
and promises behave like dimensions and datums, live results occupy a title block, and human,
agent, and simulation changes read like revisions.

### Palette

- **Drafting paper `#E9EEF0`:** main field and grid ground.
- **Sheet white `#FFFFFF`:** raised sheets, popovers, and high-contrast reading surfaces.
- **Graphite ink `#16242B`:** primary outlines, text, measured geometry, and neutral state.
- **Cyanotype blue `#1F5F8B`:** annotations, selection, operator controls, and active view.
- **Oxide red `#B0402C`:** late, blocked, or outside-tolerance state only.
- **Drafting green `#2F6F4F`:** due-date datum, kept promise, and resolved state.

Colour is always paired with a label, flag, hatch, icon, or line treatment. Violet/neon AI
accents, decorative gradients, glass surfaces, and broad dark fills do not belong in S1.

### Typography and marks

- Architectural/block sans for titles, resource names, and vehicle/job labels; use Archivo or a
  packaged metric-compatible equivalent.
- IBM Plex Mono for time, IDs, dimensions, counters, percentages, scenario revisions, and title
  block data.
- Uppercase tracked micro-labels are reserved for drawing metadata and statuses, not body copy.
- Use engineering line weights, dimension terminators, revision marks, datum flags, hatching, and
  a light drafting-paper grid consistently.
- Icons are compact industrial SVG marks with a shared stroke vocabulary. They communicate
  resources, parts, people, channels, and state; they are not ornament.

## Frozen composition

### Shared frame

- Header: shift clock, large promise counter, `Board | Floor` switch, and `Agent linked` WebMCP
  pill.
- `Today's promises`: six side-view vehicle silhouettes with promise times and explicit
  kept/at-risk signals.
- Exactly one dominant alert card during escalation.
- Live-figures strip on the bottom edge.
- Ephemeral hover/click/focus popovers for cars, resources, and technicians.

### Opening view — Shift Board

- Time-first 14:15–18:00 drawing field.
- One lane each for Diagnostics, Bay 1, Bay 2, and Bay 3.
- Jobs are side-view vehicle blocks positioned from simulation segments.
- Promise flags sit on the time axis; blocked windows use a hatch; late work uses oxide red.
- A compact floor strip shows Bay 1–3, Diagnostics, and Parts.

### Alternate view — Isometric Shop

- The header switch reveals a full-bleed diagonal 2.5D SVG floor.
- It contains the waiting lot, three lifts, diagnostics, exit, and parts van.
- It renders the same canonical world and story state as the Shift Board.
- This is 2D SVG, not WebGL or a 3D engine. Do not add Three.js, a full 3D plant, CAD import, or a
  second visual state model.

## Story states

1. **Calm:** innocent `How's the line looking today?`; 6/6 on plan.
2. **Escalation:** the Bay 3 part delay is discovered; one alert, hatched block, two promises at
   risk, projected 4/6.
3. **Running:** visible deterministic scenario exploration with descriptions, progress bars,
   run counter, best-so-far, and confidence/rate.
4. **Proposal:** evidence-backed plan; draggable cards let the human refine routing or priority.
5. **Resolved:** applied human + agent plan reaches 6/6; Slack/email/SMS chips are simulated UI
   state only and make no external calls.

The Board/Floor switch changes presentation, never the story or operational state.

## Motion and interaction

- Motion explains reflow, routing, scenario progress, state transition, and causality.
- Prefer short fades/translations, schedule-block reflow, counter changes, and SVG path motion.
- Popovers must work on hover, click, and keyboard focus and remain within the viewport.
- Respect `prefers-reduced-motion`; no ambient or decorative animation.

## Viewports and quality floor

- Primary: ChatGPT desktop app browser pane at approximately **1160×865**.
- Monitor: approximately **1567×995**; record the final video at 1080p.
- No horizontal scrolling, clipped shared strips, hidden controls, or popovers outside the pane.
- English copy only for the demo.
- Side-view vehicle silhouettes must be original or have a documented compatible licence; current
  glyphs are placeholders until that source is settled.
- Keyboard focus, semantic labels, reduced motion, and colour-independent state cues are required.

## Avoid

- Generic SaaS sidebar/nav/card grids
- Dense walls of metrics or explanatory prose
- Dark/neon AI-console aesthetics
- Multiple simultaneous alert cards
- Decorative blueprint motifs that do not encode information
- An internal chatbot
- Backend/auth/database/real notification integrations for the MVP
- WebGL, 3D engines, CAD surfaces, or default React Flow rectangles
