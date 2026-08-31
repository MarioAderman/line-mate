"use client";

/**
 * Today's promises: the six cars a customer is waiting for, in due order.
 * State is never colour alone — a kept promise carries a check, a missed one
 * carries an exclamation and an "at risk" label.
 */
import { formatMinute } from "@/domain";
import { useActiveScenario, useActiveSimulation } from "@/store";
import { promiseChips, type PromiseChip } from "@/components/derive";
import { Vehicle } from "@/components/vehicles";
import { FRAME } from "./metrics";
import { usePopoverAnchor } from "./Popover";

const TONE: Record<PromiseChip["tone"], { cell: string; text: string; stroke: string; mark: string; label: string }> = {
  kept: {
    cell: "border-rule-2 bg-sheet",
    text: "text-ink",
    stroke: "var(--ink)",
    mark: "✓",
    label: "kept",
  },
  missed: {
    cell: "border-alarm bg-alarm-wash",
    text: "text-alarm",
    stroke: "var(--alarm)",
    mark: "!",
    label: "at risk",
  },
  open: {
    cell: "border-rule bg-sheet",
    text: "text-ink-2",
    stroke: "var(--ink-2)",
    mark: "·",
    label: "open",
  },
};

function Chip({ chip }: { chip: PromiseChip }) {
  const tone = TONE[chip.tone];
  const anchor = usePopoverAnchor({ kind: "workItem", id: chip.workItemId });
  return (
    <button
      type="button"
      {...anchor}
      aria-label={`${chip.vehicle}, promised ${formatMinute(chip.dueMinute)}, ${tone.label}`}
      className={`flex h-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-sheet border px-1 text-center transition-colors ${tone.cell}`}
    >
      <Vehicle kind={chip.kind} stroke={tone.stroke} fill="var(--sheet)" width={46} />
      <span className={`w-full truncate text-[0.66rem] leading-tight ${tone.text}`}>{chip.vehicle}</span>
      <span className={`flex items-center gap-1 font-mono text-[0.68rem] font-semibold ${tone.text}`}>
        <span aria-hidden>{tone.mark}</span>
        {formatMinute(chip.dueMinute)}
      </span>
    </button>
  );
}

export function PromisesStrip() {
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const chips = promiseChips(scenario, simulation);
  const atRisk = chips.filter((c) => c.tone === "missed").length;

  return (
    <section
      aria-label="Today's promises"
      style={{ height: FRAME.promises }}
      className="flex shrink-0 items-stretch gap-3 border-b border-rule-2 bg-paper-2 px-4 py-2"
    >
      <div className="flex w-[104px] shrink-0 flex-col justify-center">
        <p className="hmi-label text-[0.6rem] leading-tight">Today&apos;s</p>
        <p className="hmi-label text-[0.6rem] leading-tight">promises</p>
        <p className={`font-mono text-[0.62rem] font-semibold ${atRisk > 0 ? "text-alarm" : "text-ink-3"}`}>
          {atRisk > 0 ? `${atRisk} at risk` : "all on plan"}
        </p>
      </div>
      <ul className="grid min-w-0 flex-1 grid-cols-6 gap-2">
        {chips.map((chip) => (
          <li key={chip.workItemId} className="min-w-0">
            <Chip chip={chip} />
          </li>
        ))}
      </ul>
    </section>
  );
}
