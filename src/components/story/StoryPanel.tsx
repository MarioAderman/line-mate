"use client";

/**
 * The sheet every story panel is drawn on: a title block, a drawing field and
 * an optional footer rule. Slides in from the right in 200 ms, or appears
 * without motion when the viewer asked for less of it.
 */
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** Frozen composition: the panel never grows past the right margin. */
export const STORY_PANEL_WIDTH = 336;

const SHEET_SHADOW = "0 2px 12px color-mix(in srgb, var(--ink) 12%, transparent)";

export interface StoryPanelProps {
  title: string;
  /** Right-hand side of the title block: revision, state, counter. */
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Alarm-toned title block; used by nothing yet, kept for the alert path. */
  tone?: "ink" | "agent";
  label?: string;
}

export function StoryPanel({ title, meta, children, footer, tone = "ink", label }: StoryPanelProps) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      aria-label={label ?? title}
      className="pointer-events-auto flex max-h-full flex-col overflow-hidden border border-ink bg-sheet"
      style={{ width: STORY_PANEL_WIDTH, borderRadius: "var(--radius-sheet)", boxShadow: SHEET_SHADOW }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.98 }}
      transition={{ duration: reduced ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
    >
      <header
        className={`flex items-baseline justify-between gap-3 border-b px-3 py-2 ${
          tone === "agent" ? "border-agent bg-agent-wash" : "border-rule bg-paper-2"
        }`}
      >
        <h2 className="hmi-label !text-ink">{title}</h2>
        {meta ? <span className="font-mono text-[11px] text-ink-2">{meta}</span> : null}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      {footer ? (
        <footer className="border-t border-rule bg-paper-2 px-3 py-2 font-mono text-[10px] text-ink-3">
          {footer}
        </footer>
      ) : null}
    </motion.section>
  );
}

/** Datum rule used between blocks inside a panel. */
export function PanelRule() {
  return <div className="mx-3 border-t border-dashed border-rule" />;
}
