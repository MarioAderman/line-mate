"use client";

import { useState } from "react";
import { useScenarioCards, useWorkshopStore } from "@/store";

export function ScenarioStrip() {
  const cards = useScenarioCards();
  const run = useWorkshopStore((s) => s.run);
  const setPlaybackMinute = useWorkshopStore((s) => s.setPlaybackMinute);
  const [name, setName] = useState("");

  return (
    <section className="hmi-panel flex min-h-[96px] flex-col" aria-label="Scenarios">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
        <span className="hmi-label">Scenarios</span>
        <span className="font-mono text-xs text-porcelain-dim">baseline is protected · agents branch first</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-2 p-2">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            aria-pressed={card.active}
            onClick={() => {
              run("activate_scenario", { scenarioId: card.id }, "human");
              setPlaybackMinute(null);
            }}
            className={`flex min-w-[150px] flex-col border px-3 py-2 text-left ${
              card.active ? "border-coolant bg-graphite-2" : "border-line hover:border-line-strong"
            }`}
          >
            <span className="font-display text-base font-semibold uppercase tracking-wider">{card.name}</span>
            <span className="font-mono text-xs text-porcelain-dim">
              {card.simulated
                ? `${card.promisesMet} / ${card.promisedTotal} promises`
                : `${card.promisedTotal} promises · not run`}
            </span>
            {card.parentId && <span className="font-mono text-[10px] text-porcelain-dim">from {card.parentId}</span>}
          </button>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("create_scenario", { name: name.trim() || `Plan ${cards.length}` }, "human");
            setName("");
          }}
        >
          <input
            className="hmi-input w-36"
            placeholder="New scenario name"
            aria-label="New scenario name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="hmi-button">
            Branch
          </button>
        </form>
      </div>
    </section>
  );
}
