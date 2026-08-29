"use client";

import { BASELINE_SCENARIO_ID, type Scenario } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { useWorkshopStore } from "@/store";
import { money } from "./floor";

interface Props {
  scenario: Scenario;
  simulation: SimulationResult | null;
}

interface Tile {
  label: string;
  value: string;
  delta?: string;
  tone?: "good" | "bad";
}

export function MetricsRail({ scenario, simulation }: Props) {
  const baseline = useWorkshopStore((s) => s.simulations[BASELINE_SCENARIO_ID] ?? null);
  const compare = scenario.id !== BASELINE_SCENARIO_ID && baseline && simulation ? baseline : null;
  const t = simulation?.totals;

  const delta = (key: "completed" | "promisesMet" | "avgWaitMinutes" | "laborCostUsd" | "revenueUsd", fmt: (v: number) => string) =>
    compare && t ? signed(t[key] - compare.totals[key], fmt) : undefined;

  const tiles: Tile[] = [
    {
      label: "Throughput",
      value: t ? `${t.completed} / ${t.total} jobs` : "—",
      delta: delta("completed", (v) => `${v}`),
    },
    {
      label: "Promises",
      value: t ? `${t.promisesMet} / ${t.promisedTotal}` : `${scenario.workItems.filter((w) => w.dueMinute !== null).length} due`,
      delta: delta("promisesMet", (v) => `${v}`),
      tone: t ? (t.promisesMet === t.promisedTotal ? "good" : "bad") : undefined,
    },
    { label: "Avg wait", value: t ? `${Math.round(t.avgWaitMinutes)} min` : "—", delta: delta("avgWaitMinutes", (v) => `${Math.round(v)}m`) },
    {
      label: "Utilisation",
      value: t ? `${Math.round(t.bayUtilization * 100)}% bays · ${Math.round(t.technicianUtilization * 100)}% techs` : "—",
    },
    {
      label: "Revenue / labor",
      value: t ? `${money(t.revenueUsd)} / ${money(t.laborCostUsd)}` : "—",
      delta: delta("revenueUsd", (v) => money(v)),
    },
  ];

  return (
    <section className="hmi-panel grid grid-cols-2 divide-x divide-line md:grid-cols-5" aria-label="Operational metrics">
      {tiles.map((tile) => (
        <div key={tile.label} className="px-3 py-2">
          <div className="hmi-label">{tile.label}</div>
          <div
            className={`font-mono text-lg leading-tight ${
              tile.tone === "good" ? "text-coolant" : tile.tone === "bad" ? "text-coral" : ""
            }`}
          >
            {tile.value}
          </div>
          <div className="h-4 font-mono text-[11px] text-porcelain-dim">
            {tile.delta ? `${tile.delta} vs baseline` : simulation ? (compare ? "" : "") : "not simulated"}
          </div>
        </div>
      ))}
      {simulation?.totals.bottleneck && (
        <div className="col-span-2 border-t border-line px-3 py-1.5 text-xs md:col-span-5">
          <span className="hmi-label mr-2 text-amber">Bottleneck</span>
          {simulation.totals.bottleneck.reason}
        </div>
      )}
    </section>
  );
}

function signed(v: number, fmt: (v: number) => string): string {
  if (v === 0) return "±0";
  return `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))}`;
}
