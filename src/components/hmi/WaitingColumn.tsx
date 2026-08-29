"use client";

import { formatMinute, type Scenario, type WorkItem } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { useWorkshopStore } from "@/store";
import { promiseTone, workMinutes, type FloorView } from "./floor";

interface Props {
  scenario: Scenario;
  simulation: SimulationResult | null;
  floor: FloorView;
}

export const DRAG_MIME = "application/x-workshop-work-item";

export function WaitingColumn({ scenario, simulation, floor }: Props) {
  const select = useWorkshopStore((s) => s.select);
  const selection = useWorkshopStore((s) => s.selection);

  const waiting = [...floor.waiting].sort(
    (a, b) => a.priority - b.priority || (a.dueMinute ?? 9999) - (b.dueMinute ?? 9999),
  );

  return (
    <aside className="hmi-panel flex min-h-0 min-w-0 flex-col" aria-label="Waiting jobs and technicians">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
        <span className="hmi-label">Waiting</span>
        <span className="font-mono text-xs text-porcelain-dim">{waiting.length} vehicles</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-2" role="list">
        {waiting.length === 0 && (
          <li className="px-1 py-2 text-xs text-porcelain-dim">Nothing waiting at {formatMinute(floor.minute)}.</li>
        )}
        {waiting.map((item) => (
          <WaitingCard
            key={item.id}
            item={item}
            scenario={scenario}
            tone={promiseTone(item, simulation)}
            selected={selection?.kind === "workItem" && selection.id === item.id}
            onSelect={() => select({ kind: "workItem", id: item.id })}
          />
        ))}
      </ul>
      <div className="border-t border-line px-3 py-2">
        <span className="hmi-label">Technicians</span>
        <ul className="mt-1 flex flex-col gap-1" role="list">
          {scenario.technicians.map((tech) => {
            const busy = floor.busyTechnicianIds.has(tech.id);
            const stat = simulation?.technicians.find((t) => t.technicianId === tech.id);
            return (
              <li key={tech.id}>
                <button
                  type="button"
                  onClick={() => select({ kind: "technician", id: tech.id })}
                  className={`flex w-full items-center justify-between gap-2 border px-2 py-1 text-left text-xs ${
                    selection?.kind === "technician" && selection.id === tech.id
                      ? "border-coolant"
                      : "border-transparent hover:border-line-strong"
                  }`}
                >
                  <span>
                    <span
                      aria-hidden
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full ${busy ? "bg-amber" : "bg-coolant/60"}`}
                    />
                    {tech.name}
                    <span className="ml-1 text-porcelain-dim">{tech.skills.join(" · ")}</span>
                  </span>
                  <span className="font-mono text-porcelain-dim">
                    {stat ? `${Math.round(stat.utilization * 100)}%` : busy ? "busy" : "free"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function WaitingCard({
  item,
  scenario,
  tone,
  selected,
  onSelect,
}: {
  item: WorkItem;
  scenario: Scenario;
  tone: ReturnType<typeof promiseTone>;
  selected: boolean;
  onSelect: () => void;
}) {
  const pinned = item.route.resourceId
    ? scenario.resources.find((r) => r.id === item.route.resourceId)?.name
    : null;
  return (
    <li className="mb-1">
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, item.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={onSelect}
        aria-label={`${item.vehicle}, ${item.name}, priority ${item.priority}${
          item.dueMinute !== null ? `, promised by ${formatMinute(item.dueMinute)}` : ""
        }. Drag onto a bay to route it.`}
        className={`block w-full cursor-grab border-l-2 bg-graphite-2 px-2 py-1.5 text-left active:cursor-grabbing ${
          tone === "missed"
            ? "border-coral"
            : tone === "kept"
              ? "border-coolant"
              : tone === "open"
                ? "border-amber"
                : "border-line"
        } ${selected ? "outline outline-1 outline-coolant" : ""}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{item.vehicle}</span>
          <span className="font-mono text-[11px] text-porcelain-dim">P{item.priority}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 text-[11px] text-porcelain-dim">
          <span className="truncate">{item.name}</span>
          <span className="font-mono">{workMinutes(item)}m</span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[11px]">
          <span className={tone === "missed" ? "text-coral" : tone === "none" ? "text-porcelain-dim" : "text-amber"}>
            {item.dueMinute === null ? "walk-in" : `promised ${formatMinute(item.dueMinute)}`}
          </span>
          {pinned && <span className="text-porcelain-dim">→ {pinned}</span>}
        </div>
      </button>
    </li>
  );
}
