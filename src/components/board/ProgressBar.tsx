"use client";

/**
 * The drafting progress bar: a ruled trough with an ink fill and a monospaced
 * caption sitting above its right end, like a dimension figure over a measured
 * length. It carries no clock of its own — the caller passes the fraction it
 * derived from `store.playbackMinute`, so every bar on the sheet moves together.
 *
 * `hatch` is the blocked case: the fill is hatched rather than solid, because a
 * bay waiting on a part is not making progress, it is burning the shift.
 */

export type BarTone = "ink" | "agent" | "alarm" | "warn";

const FILL: Record<BarTone, string> = {
  ink: "bg-ink",
  agent: "bg-agent",
  alarm: "bg-alarm",
  warn: "bg-warn",
};

const CAPTION: Record<BarTone, string> = {
  ink: "text-ink-2",
  agent: "text-agent",
  alarm: "text-alarm",
  warn: "text-warn",
};

/** Hatch id per tone: one pattern definition can serve every bar on the sheet. */
const HATCH_ID = "board-bar-hatch";

/** The hatch pattern, defined once per page and referenced by every bar. */
export function BarHatchDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" className="absolute">
      <defs>
        <pattern id={HATCH_ID} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--alarm)" strokeWidth="2.4" />
        </pattern>
      </defs>
    </svg>
  );
}

interface Props {
  /** 0..1. Anything outside is clamped by the caller's `windowProgress`. */
  value: number;
  tone?: BarTone;
  /** Monospaced figure above the right end, e.g. "26 / 45 min". */
  caption?: string;
  /** Blocked: the fill is hatched, not solid. */
  hatch?: boolean;
  /** Read out for people who never see the bar. */
  label: string;
}

export function ProgressBar({ value, tone = "ink", caption, hatch = false, label }: Props) {
  const percent = Math.min(100, Math.max(0, value * 100));
  return (
    <div className={caption ? "relative mt-3.5" : "relative mt-1"}>
      {caption && (
        <span
          className={`pointer-events-none absolute -top-3 right-0 font-mono text-[0.56rem] leading-none ${CAPTION[tone]}`}
        >
          {caption}
        </span>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={label}
        className="relative h-[6px] border border-rule bg-paper"
      >
        {hatch ? (
          <svg
            className="absolute inset-y-0 left-0 h-full transition-[width] duration-500 ease-linear"
            style={{ width: `${percent}%` }}
            aria-hidden
            focusable="false"
          >
            <rect width="100%" height="100%" fill={`url(#${HATCH_ID})`} />
          </svg>
        ) : (
          <span
            aria-hidden
            style={{ width: `${percent}%` }}
            className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-linear ${FILL[tone]}`}
          />
        )}
      </div>
    </div>
  );
}
