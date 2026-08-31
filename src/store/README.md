# `src/store`

The single live world (Zustand) plus the view/story state around it.

- `workshopStore.ts` — the canonical state. `run()` is the only door for world changes; it
  wraps `executeCommand`, and a small interception layer advances the visible story when the
  agent acts (exploration replay, proposal, resolution) and turns agent retargets into edits
  of the on-screen draft when they address the scenario the proposal is about.
- `storySlice.ts` — the demo-story functions the UI and keyboard controls share: escalation,
  the animated exploration, proposal, apply-and-notify, reset.

The proposal draft is view state on purpose: a plan on screen is not a plan in the world until
the manager applies it.
