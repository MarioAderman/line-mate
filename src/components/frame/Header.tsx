"use client";

/**
 * Sheet header: the shift clock, the one number the whole demo turns on, the
 * Board/Floor switch and the WebMCP link pill. Everything is read from the
 * store; the switch is the only control that writes, and it writes view state.
 */
import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { formatMinute, type StoryState, type View } from "@/domain";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import { promiseChips } from "@/components/derive";
import { FRAME } from "./metrics";

const STORY_LABEL: Record<StoryState, string> = {
  calm: "On plan",
  escalation: "At risk",
  running: "Exploring",
  proposal: "Plan proposed",
  resolved: "Recovered",
};

/** Palette is fixed: ink for settled states, alarm for risk, agent for agent work. */
const STORY_TONE: Record<StoryState, string> = {
  calm: "text-ink",
  escalation: "text-alarm",
  running: "text-agent",
  proposal: "text-agent",
  resolved: "text-ink",
};

const VIEW_LABEL: Record<View, string> = { board: "Board", floor: "Floor" };

/** Counts up or down when the plan changes; static under reduced motion. */
function Counter({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const previous = useRef(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (reduced || from === value) {
      setDisplay(value);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.5,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduced]);

  return <>{display}</>;
}

export function Header() {
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const story = useWorkshopStore((s) => s.story);
  const view = useWorkshopStore((s) => s.view);
  const setView = useWorkshopStore((s) => s.setView);
  const mcpStatus = useWorkshopStore((s) => s.mcpStatus);
  const mcpToolCount = useWorkshopStore((s) => s.mcpToolCount);

  const promised = promiseChips(scenario, simulation).length;
  const met = simulation ? simulation.totals.promisesMet : promised;
  const linked = mcpStatus === "linked";
  const linkLabel =
    mcpStatus === "linked"
      ? `Agent linked · ${mcpToolCount} tools`
      : mcpStatus === "detecting"
        ? "Linking agent…"
        : mcpStatus === "unsupported"
          ? "Agent bridge unavailable"
          : "Agent link error";

  return (
    <header
      style={{ height: FRAME.header }}
      className="flex shrink-0 items-center gap-6 border-b border-ink bg-sheet px-4"
    >
      <div className="flex shrink-0 items-baseline gap-3">
        <span className="font-mono text-[1.6rem] font-semibold leading-none text-ink">
          {formatMinute(scenario.clock.startMinute)}
        </span>
        <span className="hmi-label text-[0.6rem]">
          {scenario.clock.dayLabel} · closes {formatMinute(scenario.clock.endMinute)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
        <p className={`font-mono text-[1.9rem] font-semibold leading-none ${STORY_TONE[story]}`}>
          <Counter value={met} />
          <span className="text-ink-3"> / {promised}</span>
        </p>
        <div className="leading-tight">
          <p className="hmi-label text-[0.6rem]">promises</p>
          <p className={`font-mono text-[0.68rem] font-semibold uppercase tracking-[0.12em] ${STORY_TONE[story]}`}>
            {STORY_LABEL[story]}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div role="group" aria-label="View" className="flex rounded-sheet border border-rule-2">
          {(["board", "floor"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={`px-3 py-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.14em] transition-colors ${
                view === option
                  ? "bg-agent-wash text-agent"
                  : "bg-sheet text-ink-3 hover:text-ink"
              }`}
            >
              {VIEW_LABEL[option]}
            </button>
          ))}
        </div>

        <p
          data-mcp={mcpStatus}
          className={`flex items-center gap-2 rounded-sheet border px-2.5 py-1.5 font-mono text-[0.64rem] font-semibold uppercase tracking-[0.1em] ${
            linked ? "border-agent bg-agent-wash text-agent" : "border-rule-2 bg-sheet text-ink-3"
          }`}
        >
          <span
            aria-hidden
            className={`inline-block h-2 w-2 rounded-full border ${
              linked ? "border-agent bg-agent" : "border-rule-2 bg-transparent"
            }`}
          />
          {linkLabel}
        </p>
      </div>
    </header>
  );
}
