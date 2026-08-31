# WebMCP tool strategy v0.2

Use the Imperative API through `document.modelContext.registerTool`. Keep registration isolated
and feature-detected because WebMCP is experimental.

The agent-facing surface contains exactly **13 registered tools**:

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
- `apply_plan`: apply the approved recovery plan to a non-baseline scenario; agent-exposed for
  the final video beat after the human confirms the proposal.
- `post_shift_note`: record the resolution note and simulated notification-channel chips; it does
  not call Slack, email, SMS, or any external service.

## Actions

- `run_simulation`: calculate and persist deterministic results for a scenario.
- `explore_schedules`: run bounded, seeded schedule exploration and return measured confidence,
  counters, and only the top-ranked candidates.

The complete agent-exposed surface is the original ten plus `explore_schedules`, `apply_plan`,
and `post_shift_note`. `inject_event`, `activate_scenario`, and `reset_demo` remain human/demo
controls and are not registered with WebMCP.

## Contract rules

- Descriptions say what a tool does and when to use it.
- Read-only tools set `annotations.readOnlyHint = true`; mutations set it to `false`.
- Input schemas reject unknown IDs and incompatible routes.
- Mutation output includes `changeId`, actor, scenario, and a concise before/after summary.
- Responses are JSON-safe and bounded; the event timeline is summarized unless explicitly asked.
- Exploration confidence is computed from seeded replications and displayed as measured. Never
  hardcode a confidence percentage in a tool response or UI label.
- Tools never expose secrets, private files, or arbitrary command execution.
- Register only tools useful in the current page state and clean up with an `AbortController`.
