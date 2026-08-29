# Architecture v0.1

Status: frozen for the first vertical slice.

## Core rule

UI, simulation, and WebMCP never maintain separate copies of the operational world. Human actions
and agent tools call the same application commands against one canonical store. Every mutation
records its actor and scenario.

```text
React UI ─────────────┐
                     v
               application commands ─────> canonical store
                     ^                         │       │
WebMCP adapter ───────┘                         │       └─> change history
                                               v
                                      deterministic simulation
```

## Boundaries

### Domain

Serializable types only: scenarios, resources, technicians, work items, process steps,
constraints, results, simulation events, and attributed changes. Domain code knows nothing about
React, Zustand, React Flow, or WebMCP.

### Simulation

A pure function receives a scenario and returns a result. The initial engine advances between
events rather than rendering or calculating every animation frame. It must be deterministic,
fast in a browser, and tested with deliberately constrained fixtures.

### Commands

Semantic operations such as `inspectSystem`, `createScenario`, `updateResource`,
`routeWorkItem`, and `runSimulation`. Validation and change attribution live here. UI handlers and
WebMCP execution must not bypass this boundary.

### Store

Owns scenarios, active selection, selected visual entity, latest simulation results, and change
history. It is an application state container, not a second domain model.

### WebMCP

Feature-detect `document.modelContext`, register a small non-overlapping tool set, and clean up
registrations. Convert tool input to commands and command output to bounded JSON-safe responses.
No simulation internals belong here.

### UI

The world canvas dominates. Supporting regions are the inspector, operational metrics, scenario
comparison, and attributed activity. The external browser agent is the conversational interface;
the app does not contain a chatbot.

## Deliberately deferred

- Backend, auth, accounts, database, collaboration server
- OpenAI API calls inside the product
- CAD, FEA, CFD, orbital physics, or scientifically ambitious simulation
- 3D rendering
- General-purpose scenario editor and large component library

