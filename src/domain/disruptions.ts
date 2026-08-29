/**
 * Disruptions are how the story moves from calm to escalation without a
 * second hand-written fixture: the escalated baseline is the calm shop plus
 * one deterministic part delay.
 */
import { formatMinute } from "./types";
import type { Disruption, Scenario } from "./types";

/** Friday's incident: Bay 3 waits for a water pump until 15:30. */
export const PART_DELAY: Disruption = {
  id: "DIS-PART-DELAY",
  kind: "part_delay",
  resourceId: "bay-3",
  untilMinute: 15 * 60 + 30,
  reason: "Waiting for a water pump — supplier ETA 15:30",
  workItemId: "veh-12",
  remainingStep: { operation: "Water pump replacement", durationMinutes: 60 },
};

/** Pure: returns a copy of the scenario with the disruption applied. */
export function applyDisruption(scenario: Scenario, disruption: Disruption): Scenario {
  const next = structuredClone(scenario);
  const resource = next.resources.find((r) => r.id === disruption.resourceId);
  if (!resource) throw new Error(`Unknown resource "${disruption.resourceId}".`);
  resource.status = "blocked";
  resource.blockedUntilMinute = disruption.untilMinute;
  resource.blockingReason = disruption.reason;
  if (disruption.workItemId) {
    const item = next.workItems.find((w) => w.id === disruption.workItemId);
    if (item) {
      item.status = "blocked";
      if (disruption.remainingStep) {
        item.steps[0] = { ...item.steps[0], ...disruption.remainingStep };
      }
    }
  }
  return next;
}

/** Copy the UI shows when the disruption lands. */
export function describeDisruption(disruption: Disruption, scenario: Scenario): string {
  const resource = scenario.resources.find((r) => r.id === disruption.resourceId);
  return `Part delay on ${resource?.name ?? disruption.resourceId} — ${disruption.reason.replace(
    /^Waiting for a /,
    "",
  )} (${formatMinute(disruption.untilMinute)})`;
}
