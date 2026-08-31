# `src/domain`

The canonical, serializable model of the shop: scenarios, resources (bays, diagnostics,
technicians), work items with promises and steps, plans, shift notes, and change records.

- `types.ts` — every shared type plus the zod schemas used at external boundaries.
- `fixtures.ts` — the deterministic Friday-afternoon shop (6 promises, 12 cars). The calm and
  escalated worlds are the same fixture; the escalation is a disruption applied on top.
- `disruptions.ts` — operational disruptions (the Bay 3 water-pump delay) applied as pure
  functions over a scenario.
- `demo.ts` — the scripted demo beats (agent plan, human decision) expressed as plain plans.

No React, no engine logic — anything here must survive `structuredClone` and `JSON.stringify`.
