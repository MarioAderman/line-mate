"use client";

/**
 * The opening view: a time-first drawing of the shift.
 *
 * Floor strip on top, then one lane per resource on a 14:15 → 18:00 axis that
 * stretches to the pane. Everything on the field comes from the canonical
 * store — the scenario for the geometry, the cached simulation for the blocks
 * — and the only command it issues is the run that fills that cache.
 */
import { useEffect, useMemo } from "react";
import { formatMinute } from "@/domain";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import { lanes as deriveLanes, promiseChips } from "@/components/derive";
import { FRAME } from "@/components/frame";
import { FloorStrip } from "./FloorStrip";
import { Lane } from "./Lane";
import { TimeAxis } from "./TimeAxis";
import { LABEL_WIDTH, minutePercent, ticks, useElementWidth } from "./scale";

export function ShiftBoard() {
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const run = useWorkshopStore((s) => s.run);
  const activeScenarioId = useWorkshopStore((s) => s.activeScenarioId);
  const playbackMinute = useWorkshopStore((s) => s.playbackMinute);
  const [fieldRef, fieldWidth] = useElementWidth<HTMLDivElement>();

  const clock = scenario.clock;
  const minute = playbackMinute ?? clock.startMinute;
  const trackWidth = Math.max(0, fieldWidth - LABEL_WIDTH - 2);

  // The board draws simulation segments, so it fills the cache when it is
  // empty. Everything still goes through the command boundary.
  useEffect(() => {
    if (simulation) return;
    run("run_simulation", { scenarioId: activeScenarioId }, "simulation");
  }, [run, activeScenarioId, simulation]);

  const chips = useMemo(() => promiseChips(scenario, simulation), [scenario, simulation]);

  // Diagnostics leads the drawing, then the bays in fixture order.
  const ordered = useMemo(() => {
    const byId = new Map(scenario.resources.map((r) => [r.id, r]));
    return deriveLanes(scenario, simulation)
      .map((lane) => ({ lane, type: byId.get(lane.resourceId)?.type ?? "bay" }))
      .sort((a, b) => (a.type === "station" ? 0 : 1) - (b.type === "station" ? 0 : 1));
  }, [scenario, simulation]);

  const nowPercent = minutePercent(minute, clock);

  return (
    <div
      data-slot="board"
      className="flex h-full min-h-0 flex-col gap-2.5 px-4 pt-3"
      style={{ paddingBottom: FRAME.band }}
    >
      <FloorStrip scenario={scenario} simulation={simulation} minute={minute} />

      <div ref={fieldRef} className="relative flex min-h-0 flex-1 flex-col rounded-sheet border border-ink bg-paper-2">
        {/* Drafting rules behind the lanes: 15-minute minors, solid hours. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-0" style={{ left: LABEL_WIDTH }} aria-hidden>
          {ticks(clock, 15).map((tick) => (
            <span
              key={tick}
              style={{ left: `${minutePercent(tick, clock)}%` }}
              className={`absolute inset-y-0 w-px ${tick % 60 === 0 ? "bg-rule" : "bg-rule/40"}`}
            />
          ))}
        </div>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <TimeAxis clock={clock} chips={chips} />
          <div className="flex min-h-0 flex-1 flex-col">
            {ordered.map(({ lane, type }, index) => (
              <Lane
                key={lane.resourceId}
                lane={lane}
                type={type}
                clock={clock}
                trackWidth={trackWidth}
                last={index === ordered.length - 1}
              />
            ))}
          </div>
        </div>

        {/* Now cursor: the datum the whole drawing is measured from. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20" style={{ left: LABEL_WIDTH }} aria-hidden>
          <div className="absolute inset-y-0 border-l-2 border-ink" style={{ left: `${nowPercent}%` }}>
            <span className="hmi-label absolute left-1 top-1 whitespace-nowrap bg-paper-2 px-1 text-[0.52rem] text-ink">
              now {formatMinute(minute)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
