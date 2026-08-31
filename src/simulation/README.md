# `src/simulation`

The deterministic discrete-event engine and the schedule search. Pure TypeScript, no React,
no randomness outside the seeded generator (mulberry32) — same scenario and seed, same numbers
on every machine.

- `engine.ts` — simulates one shift: queue discipline, promises, utilization, revenue/cost,
  bottleneck attribution.
- `explore.ts` — bounded candidate generation (priorities, bay pins, queue positions, released
  pins) scored across seeded replications with common random numbers. Returns measured
  promise-keep rates — confidence is computed, never hardcoded — and yields progress frames so
  the UI can animate the real search.
