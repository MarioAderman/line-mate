"use client";

/**
 * The shift axis: 14:15 to 18:00, with the six customer promises standing on
 * it as datum flags. A flag turns oxide red and swaps its check for an
 * exclamation when the run misses that promise.
 */
import { formatMinute, type Clock } from "@/domain";
import type { PromiseChip } from "@/components/derive";
import { usePopoverAnchor } from "@/components/frame";
import { AXIS_HEIGHT, LABEL_WIDTH, minutePercent, ticks } from "./scale";

const FLAG_TONE: Record<PromiseChip["tone"], { text: string; mark: string; word: string }> = {
  kept: { text: "text-ink", mark: "✓", word: "kept" },
  missed: { text: "text-alarm", mark: "!", word: "at risk" },
  open: { text: "text-ink-3", mark: "·", word: "open" },
};

function Flag({ chip, clock }: { chip: PromiseChip; clock: Clock }) {
  const anchor = usePopoverAnchor({ kind: "workItem", id: chip.workItemId });
  const tone = FLAG_TONE[chip.tone];
  const percent = minutePercent(chip.dueMinute, clock);
  const align = percent >= 96 ? "items-end" : percent <= 4 ? "items-start" : "items-center";
  return (
    <button
      type="button"
      {...anchor}
      style={{ left: `${percent}%` }}
      aria-label={`${chip.vehicle} promised ${formatMinute(chip.dueMinute)}, ${tone.word}`}
      className={`absolute bottom-0 flex w-0 flex-col ${align} ${tone.text}`}
    >
      <span className="whitespace-nowrap font-mono text-[0.6rem] font-semibold leading-none">
        <span aria-hidden>{tone.mark}</span> {formatMinute(chip.dueMinute)}
      </span>
      <span aria-hidden className="text-[0.55rem] leading-none">
        ▼
      </span>
    </button>
  );
}

export function TimeAxis({ clock, chips }: { clock: Clock; chips: PromiseChip[] }) {
  const marks = ticks(clock, 15);
  return (
    <div
      style={{ height: AXIS_HEIGHT, gridTemplateColumns: `${LABEL_WIDTH}px minmax(0,1fr)` }}
      className="grid shrink-0 border-b border-ink"
    >
      <div className="flex flex-col justify-end border-r border-rule-2 px-3 pb-1">
        <span className="hmi-label text-[0.52rem]">Promises</span>
      </div>
      <div className="relative min-w-0">
        <div className="absolute inset-x-0 bottom-[18px] top-0">
          {chips.map((chip) => (
            <Flag key={chip.workItemId} chip={chip} clock={clock} />
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[18px] border-t border-rule-2">
          {marks.map((minute) => {
            const percent = minutePercent(minute, clock);
            const hour = minute % 60 === 0;
            const align =
              percent >= 96 ? "items-end" : percent <= 2 ? "items-start" : "items-center";
            return (
              <span key={minute} style={{ left: `${percent}%` }} className={`absolute top-0 flex w-0 flex-col ${align}`}>
                <span
                  aria-hidden
                  className={`w-px ${hour ? "h-[6px] bg-rule-2" : "h-[3px] bg-rule"}`}
                />
                {hour && (
                  <span className="whitespace-nowrap font-mono text-[0.58rem] leading-none text-ink-2">
                    {formatMinute(minute)}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
