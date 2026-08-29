"use client";

import { formatMinute, type Scenario } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { useWorkshopStore } from "@/store";

interface Props {
  scenario: Scenario;
  simulation: SimulationResult | null;
  minute: number;
}

export function ShiftBar({ scenario, simulation, minute }: Props) {
  const run = useWorkshopStore((s) => s.run);
  const setPlaybackMinute = useWorkshopStore((s) => s.setPlaybackMinute);
  const mcpStatus = useWorkshopStore((s) => s.mcpStatus);
  const mcpToolCount = useWorkshopStore((s) => s.mcpToolCount);

  const promised = scenario.workItems.filter((w) => w.dueMinute !== null).length;
  const met = simulation?.totals.promisesMet ?? null;
  const risk = met === null ? null : promised - met;

  return (
    <header className="hmi-panel flex min-w-0 flex-wrap items-stretch gap-x-4 gap-y-2 px-3 py-2">
      <div className="flex min-w-[150px] flex-col justify-center">
        <span className="hmi-label">{scenario.clock.dayLabel} · shift clock</span>
        <span className="font-mono text-2xl leading-none">
          {formatMinute(minute)}
          <span className="ml-2 text-xs text-porcelain-dim">closes {formatMinute(scenario.clock.endMinute)}</span>
        </span>
      </div>

      <div
        className={`flex min-w-[210px] flex-col justify-center border-l border-line pl-4 ${
          risk === null ? "" : risk > 0 ? "text-coral" : "text-coolant"
        }`}
        role="status"
        aria-live="polite"
      >
        <span className="hmi-label">Customer promises</span>
        <span className="font-display text-2xl font-semibold uppercase leading-none tracking-wide">
          {met === null ? `${promised} before closing` : `${met} / ${promised} on track`}
          {risk !== null && risk > 0 && (
            <span className="ml-2 text-sm font-medium normal-case tracking-normal">
              {risk} at risk
            </span>
          )}
        </span>
      </div>

      <div className="flex min-w-[200px] flex-1 flex-col justify-center border-l border-line pl-4">
        <label className="hmi-label" htmlFor="playback">
          Playback · {simulation ? "drag to replay the shift" : "run the simulation to replay"}
        </label>
        <input
          id="playback"
          type="range"
          className="w-full accent-[color:var(--coolant)]"
          min={scenario.clock.startMinute}
          max={scenario.clock.endMinute}
          step={1}
          value={minute}
          disabled={!simulation}
          onChange={(e) => setPlaybackMinute(Number(e.target.value))}
          aria-valuetext={formatMinute(minute)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-l border-line pl-4">
        <span
          className="font-mono text-[11px] uppercase tracking-wider text-porcelain-dim"
          title="WebMCP link state — the external browser agent uses these tools"
        >
          <span
            aria-hidden
            className={`mr-1 inline-block h-2 w-2 rounded-full ${
              mcpStatus === "linked"
                ? "bg-agent"
                : mcpStatus === "error"
                  ? "bg-coral"
                  : "bg-porcelain-dim/50"
            }`}
          />
          {mcpStatus === "linked"
            ? `agent link · ${mcpToolCount} tools`
            : mcpStatus === "unsupported"
              ? "no WebMCP in this browser"
              : mcpStatus === "error"
                ? "WebMCP error"
                : "detecting WebMCP"}
        </span>
        <button
          type="button"
          className="hmi-button hmi-button--primary"
          onClick={() => {
            run("run_simulation", { scenarioId: scenario.id }, "human");
            setPlaybackMinute(null);
          }}
        >
          Run simulation
        </button>
      </div>
    </header>
  );
}
