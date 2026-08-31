"use client";

/**
 * Exactly one dominant alert during the escalation beat.
 *
 * It is derived, never authored: the blocked resource comes from the scenario
 * (or from an injected `Disruption` once one is recorded) and the consequence
 * comes from the simulation's late promises. If the plan recovers, the card
 * has nothing to say and leaves.
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { formatMinute } from "@/domain";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import { partName, vehicleList } from "./copy";

export function AlertCard() {
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const story = useWorkshopStore((s) => s.story);
  const disruptions = useWorkshopStore((s) => s.disruptions);
  const reduced = useReducedMotion();

  const recorded = disruptions[scenario.id]?.[0] ?? null;
  const resource =
    scenario.resources.find((r) =>
      recorded
        ? r.id === recorded.resourceId
        : r.blockedUntilMinute !== null && r.blockedUntilMinute > scenario.clock.startMinute,
    ) ?? null;

  const reason = recorded?.reason ?? resource?.blockingReason ?? null;
  const until = recorded?.untilMinute ?? resource?.blockedUntilMinute ?? null;

  const atRisk = (simulation?.totals.lateWorkItems ?? []).flatMap((id) => {
    const item = scenario.workItems.find((w) => w.id === id);
    return item && item.dueMinute !== null ? [item.vehicle] : [];
  });

  const alert =
    story === "escalation" && resource !== null && reason !== null && until !== null
      ? {
          title: `Part delay on ${resource.name}`,
          detail: `${partName(reason)} lands at ${formatMinute(until)}`,
          atRisk,
        }
      : null;

  return (
    <AnimatePresence>
      {alert && (
        <motion.aside
          key="shop-alert"
          role="alert"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
          style={{ bottom: 12 }}
          className="absolute left-4 z-20 w-[520px] rounded-sheet border border-l-[3px] border-alarm bg-sheet px-3 py-2 shadow-[3px_3px_0_0_var(--rule)]"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden className="font-mono text-[0.8rem] font-semibold leading-none text-alarm">
              ▲
            </span>
            <p className="hmi-label text-[0.58rem] text-alarm">Alert</p>
          </div>
          <p className="mt-1 font-mono text-[0.92rem] font-semibold leading-tight text-alarm">{alert.title}</p>
          <p className="mt-0.5 text-[0.78rem] leading-snug text-ink">
            {alert.detail}
            {alert.atRisk.length > 0 && (
              <>
                {" · "}
                <span className="text-alarm">
                  {vehicleList(alert.atRisk)} will miss {alert.atRisk.length > 1 ? "their" : "its"} promise
                </span>
              </>
            )}
          </p>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
