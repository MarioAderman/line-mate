"use client";

/**
 * The drawing's title block. It says which sheet you are on, which scenario is
 * on the field, its revision letter, and whether the agent is on the drawing —
 * the same metadata an engineering print carries in its bottom-right corner.
 */
import type { StoryState } from "@/domain";
import { useWorkshopStore } from "@/store";
import { FRAME } from "./metrics";

const SHEET: Record<"board" | "floor", string> = {
  board: "1 · Shift board",
  floor: "2 · Isometric shop",
};

const STORY_LABEL: Record<StoryState, string> = {
  calm: "On plan",
  escalation: "At risk",
  running: "Exploring",
  proposal: "Proposed",
  resolved: "Recovered",
};

const REVISIONS = "ABCDEFGHIJ";

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 border-r border-rule px-2 py-1 last:border-r-0">
      <p className="hmi-label text-[0.5rem] leading-tight">{label}</p>
      <p className={`truncate font-mono text-[0.7rem] font-semibold leading-tight ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

export function TitleBlock() {
  const view = useWorkshopStore((s) => s.view);
  const story = useWorkshopStore((s) => s.story);
  const scenarios = useWorkshopStore((s) => s.scenarios);
  const activeScenarioId = useWorkshopStore((s) => s.activeScenarioId);
  const mcpStatus = useWorkshopStore((s) => s.mcpStatus);
  const mcpToolCount = useWorkshopStore((s) => s.mcpToolCount);

  const index = Math.max(0, scenarios.findIndex((s) => s.id === activeScenarioId));
  const scenario = scenarios[index] ?? scenarios[0];
  const linked = mcpStatus === "linked";

  return (
    <aside
      aria-label="Sheet title block"
      style={{ bottom: (FRAME.band - 66) / 2 }}
      className="absolute right-4 z-20 w-[338px] rounded-sheet border border-ink bg-sheet"
    >
      <div className="grid grid-cols-[1fr_1fr_46px] border-b border-rule">
        <Cell label="Sheet" value={SHEET[view]} />
        <Cell label="Scenario" value={scenario.name} />
        <Cell label="Rev" value={REVISIONS[index] ?? "—"} />
      </div>
      <div className="flex items-center justify-between px-2 py-1">
        <p className={`font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] ${linked ? "text-agent" : "text-ink-3"}`}>
          {linked ? `Agent linked · ${mcpToolCount} tools` : "Agent not linked"}
        </p>
        <p className="hmi-label text-[0.55rem]">{STORY_LABEL[story]}</p>
      </div>
    </aside>
  );
}
