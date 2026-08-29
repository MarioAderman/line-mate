"use client";

import { useWorkshopStore } from "@/store";
import { ACTOR_LABEL } from "./floor";

const TONE = {
  human: "border-coolant text-coolant",
  agent: "border-agent text-agent",
  simulation: "border-porcelain-dim text-porcelain-dim",
} as const;

export function ActivityFeed() {
  const changes = useWorkshopStore((s) => s.changes).slice(0, 12);
  return (
    <section className="hmi-panel flex min-h-[96px] max-h-[220px] flex-col" aria-label="Activity">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
        <span className="hmi-label">Activity · who changed what</span>
        <span className="font-mono text-xs text-porcelain-dim">{changes.length} shown</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-auto px-3 py-1" aria-live="polite" aria-relevant="additions">
        {changes.map((c) => (
          <li key={c.id} className="flex items-baseline gap-2 border-b border-line/50 py-1 text-xs">
            <span className={`w-12 shrink-0 border px-1 text-center font-mono text-[10px] uppercase tracking-wider ${TONE[c.actor]}`}>
              {ACTOR_LABEL[c.actor]}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-porcelain-dim">{c.command}</span>
            <span className="min-w-0 flex-1 truncate" title={c.summary}>
              {c.summary}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
