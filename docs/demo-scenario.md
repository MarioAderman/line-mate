# Demo scenario v0.2

## Story

Friday at 14:15. Six customer promises must be met before closing. A water-pump delay blocks
Bay 3 until 15:30; the current schedule now finishes only four of the six. No overtime, no extra
technicians, no cancellations.

## Beats (as measured, not as scripted)

1. **Diagnose.** "How's the line looking today?" The agent uses the read-only tools
   (`inspect_system`, `inspect_resource`, `inspect_work_item`) and identifies the blocked bay,
   the two promises at risk, and the constraints — without touching anything.
2. **Explore.** "Run scenarios and make sure we keep all six." The agent runs
   `explore_schedules`: 141 candidate schedules scored across seeded replications, animated live
   on the manager's screen. The winning plan — promised jobs first, release the two cars pinned
   to the blocked bay — keeps **6/6 promises in 100% of measured runs**. That number is computed
   every run, never hardcoded, and reproduces under independent seeds.
3. **Authority.** The plan lands as an editable draft. The manager locks a slot (the SUV into
   Bay 3 the minute the pump lands) — a **commitment lock, not a rescue**: the measured outcome
   is already 6/6 and stays 6/6. The point is who decides, not who wins. The agent reads the
   edited draft back (`inspect_system` exposes it with per-change authorship) and can adjust its
   own choices the same way. Nothing reaches the world until the manager presses
   **Apply & notify team**.
4. **Resolved.** `apply_plan` + `post_shift_note` (or the Apply button): 6/6 recovered, note in
   the shop log with its channels, every change attributed `human`, `agent`, or `simulation`.

## Required visible proof

- The same world changes through direct manipulation and WebMCP tools.
- The baseline stays protected: agent experiments branch first (`create_scenario`).
- Activity identifies human versus agent changes, including inside the proposal draft.
- The external agent uses structured tools rather than guessing the DOM.
- Confidence is measured on screen at the moment of success — the exploration counter, the
  per-candidate keep rates, and the final 6/6 all come from the same seeded engine run.

Working closing line: "The schedule was never only an AI problem or a human problem. It was a
coordination problem."
