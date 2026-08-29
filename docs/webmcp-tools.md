# WebMCP tool strategy v0.1

Use the Imperative API through `document.modelContext.registerTool`. Keep registration isolated
and feature-detected because WebMCP is experimental.

## Read-only

- `inspect_system`: current scenario, resources, queues, constraints, KPIs, and recent changes.
- `inspect_resource`: one resource, assignments, queue, utilization, and blocking reason.
- `inspect_work_item`: one job, promise, steps, route, and feasibility signals.
- `get_simulation_results`: structured results for one scenario.
- `compare_scenarios`: aligned KPIs and constraint violations for selected scenarios.

## Mutations

- `create_scenario`: clone a source into a named experiment; preferred before agent changes.
- `update_resource`: validated partial update of an operational resource.
- `update_work_item`: priority or allowed scheduling changes.
- `route_work_item`: move a work item to an eligible resource/queue position.

## Action

- `run_simulation`: calculate and persist deterministic results for a scenario.

## Contract rules

- Descriptions say what a tool does and when to use it.
- Read-only tools set `annotations.readOnlyHint = true`; mutations set it to `false`.
- Input schemas reject unknown IDs and incompatible routes.
- Mutation output includes `changeId`, actor, scenario, and a concise before/after summary.
- Responses are JSON-safe and bounded; the event timeline is summarized unless explicitly asked.
- Tools never expose secrets, private files, or arbitrary command execution.
- Register only tools useful in the current page state and clean up with an `AbortController`.

