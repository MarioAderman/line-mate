"use client";

/**
 * The live-figures strip on the bottom edge: light, live, never explanatory.
 * Every figure comes from `derive.liveFigures`, so the Board and the Floor
 * cannot disagree about the shop.
 */
import { useMemo } from "react";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import { floorAt, liveFigures, money } from "@/components/derive";
import { FRAME } from "./metrics";

export function LiveStrip() {
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const playbackMinute = useWorkshopStore((s) => s.playbackMinute);
  const minute = playbackMinute ?? scenario.clock.startMinute;

  const figures = useMemo(
    () => liveFigures(scenario, simulation, floorAt(scenario, simulation, minute)),
    [scenario, simulation, minute],
  );

  const cells: Array<{ label: string; value: string; tone?: string }> = [
    { label: "cars in shop", value: `${figures.carsInShop}` },
    { label: "bays busy", value: `${figures.baysBusy}/${figures.baysTotal}` },
    { label: "technicians", value: `${figures.technicians}` },
    {
      label: "avg wait",
      value: figures.avgWaitMinutes === null ? "—" : `${figures.avgWaitMinutes} min`,
    },
    { label: "booked today", value: money(figures.bookedTodayUsd) },
    {
      label: "parts on order",
      value: `${figures.partsOnOrder}`,
      tone: figures.partsOnOrder > 0 ? "text-warn" : undefined,
    },
  ];

  return (
    <section
      aria-label="Live figures"
      style={{ height: FRAME.live }}
      className="flex shrink-0 items-stretch border-t border-ink bg-sheet"
    >
      <p className="hmi-label flex w-[104px] shrink-0 items-center border-r border-rule px-4 text-[0.58rem]">
        Live
      </p>
      <dl className="grid min-w-0 flex-1 grid-cols-6">
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="flex min-w-0 items-baseline gap-2 border-r border-rule px-3 py-1 last:border-r-0"
          >
            <dt className="hmi-label truncate text-[0.55rem]">{cell.label}</dt>
            <dd className={`font-mono text-[0.86rem] font-semibold ${cell.tone ?? "text-ink"}`}>{cell.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
