# Design direction v0.1

## Subject and job

Audience: workshop managers and industrial engineers. The screen's single job is to make a
schedule failure, its operational cause, and the human/agent recovery visible without a tutorial.

## Visual system

- **Kiln graphite `#101820`:** main instrument surface.
- **Machine slate `#1B2A34`:** panels and inactive equipment.
- **Porcelain `#E7ECEB`:** primary text and diagrams.
- **Coolant cyan `#5ED3C5`:** normal flow and completed work.
- **Safety amber `#F2A63B`:** risk, attention, and current work.
- **Fault coral `#E46A54`:** late or blocked state only.

Typography roles: condensed industrial sans for headings/equipment labels, highly legible sans
for body controls, and mono for timestamps, IDs, measurements, and scenario deltas. Prefer local
or packaged fonts so the deployed build does not depend on a font CDN.

## Layout

```text
┌─ shift clock / promise risk / run control ───────────────────────┐
│                                                                 │
│  waiting jobs ──>       LIVE WORKSHOP FLOOR        inspector    │
│                       bays / people / queues                     │
│                                                                 │
├─ throughput / promises / wait / utilization / cost ─────────────┤
└─ baseline ─ agent plan ─ human + agent ─ attributed activity ───┘
```

## Signature

The memorable element is a live “flow spine”: work visibly travels through queues and bays while
the scenario strip below shows exactly which changes came from the human, agent, or simulation.
This spends motion in one place and makes collaboration legible.

## Avoid

- Generic SaaS sidebar/nav/card grid
- Neon-on-black AI aesthetic, glassmorphism, or decorative gradients
- Default React Flow rectangles
- A chat panel inside the product
- Animation that does not communicate work, state, or causality

Keyboard focus, reduced motion, color-independent status labels, and a useful narrow-screen
layout are part of the quality floor.

