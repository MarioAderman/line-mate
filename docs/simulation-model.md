# Simulation model v0.1

## Fixture

Friday, 14:15. A mid-market repair shop has three bays, a diagnostics station, three technicians,
and 10–12 vehicles. Six vehicles are promised before closing; the baseline completes four on
time. No overtime, extra technicians, or cancelled jobs are allowed.

## Canonical concepts

- `Scenario`: clock, resources, workers, work items, constraints, results, and ancestry.
- `Resource`: bay/station/machine with capacity, availability, cost, position, and status.
- `Technician`: skills, shift availability, assignment, and hourly cost.
- `WorkItem`: priority, arrival, due time, revenue, ordered steps, current status, and route.
- `ProcessStep`: duration and required resource/skill.
- `SimulationEvent`: arrival, start, completion, blocking, or release at a simulated minute.
- `SimulationResult`: completions, promises met, cost, lead time, utilization, queues,
  bottlenecks, late work, idle time, and timeline.

## Deterministic event loop

1. Seed the queue with arrivals and shift boundaries.
2. Advance the clock to the next event.
3. Apply completions/releases.
4. Allocate eligible waiting work by explicit priority, due time, and stable ID tie-breakers.
5. Schedule new completion events.
6. Continue until the shift ends or no future event exists.
7. Derive metrics from the event timeline.

The engine must not read wall-clock time or random values. UI playback compresses the returned
timeline; playback is not the simulation itself.

## Success cases

- Baseline: 4 of 6 promised vehicles finish on time.
- Agent-only plan: improves but intentionally reaches only 5 of 6.
- Human intervention plus agent adaptation: reaches 6 of 6 without breaking constraints.

