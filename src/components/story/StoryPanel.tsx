"use client";

/**
 * The sheet every story panel is drawn on: a title block, a drawing field and
 * an optional footer rule. Slides in from the right in 200 ms, or appears
 * without motion when the viewer asked for less of it.
 *
 * The whole sheet drags by its title block — plain pointer capture, no gesture
 * library — so the operator can pull it off whatever it happens to cover, the
 * floor's route animation above all. The body keeps its own gestures (route
 * cards, dropdowns, buttons).
 */
import { motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";

/**
 * The layer the panel may be dragged within. Provided by StoryLayer so the
 * sheet's title block can never be pulled outside the drawing field.
 */
export const StoryDragBounds = createContext<RefObject<HTMLDivElement | null> | null>(null);

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

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

export function StoryPanel({ title, meta, children, footer, tone = "ink", label }: StoryPanelProps) {
  const reduced = useReducedMotion();
  const bounds = useContext(StoryDragBounds);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const grip = useRef<{ pointerId: number; x: number; y: number; baseX: number; baseY: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers (tests, automation) have no capturable id; the
      // drag still works as long as the moves land on the header.
    }
    grip.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = grip.current;
    if (!start || start.pointerId !== event.pointerId) return;
    // The handle follows the pointer, so keeping the pointer inside the layer
    // keeps the title block reachable — the sheet can never be lost off-field.
    const field = bounds?.current?.getBoundingClientRect();
    const px = field ? clamp(event.clientX, field.left + 8, field.right - 8) : event.clientX;
    const py = field ? clamp(event.clientY, field.top + 8, field.bottom - 8) : event.clientY;
    setOffset({ x: start.baseX + px - start.x, y: start.baseY + py - start.y });
  };

  const onPointerEnd = () => {
    grip.current = null;
  };

  return (
    <div
      className="pointer-events-auto flex max-h-full"
      style={offset.x === 0 && offset.y === 0 ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <motion.section
        aria-label={label ?? title}
        className="flex max-h-full flex-col overflow-hidden border border-ink bg-sheet"
        style={{ width: STORY_PANEL_WIDTH, borderRadius: "var(--radius-sheet)", boxShadow: SHEET_SHADOW }}
        initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, x: 12, scale: 0.98 }}
        transition={{ duration: reduced ? 0 : 0.2, ease: [0.2, 0, 0, 1] }}
      >
        <header
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          style={{ touchAction: "none" }}
          className={`flex cursor-move select-none items-baseline justify-between gap-3 border-b px-3 py-2 ${
            tone === "agent" ? "border-agent bg-agent-wash" : "border-rule bg-paper-2"
          }`}
        >
          <h2 className="hmi-label !text-ink">{title}</h2>
          {meta ? <span className="font-mono text-[11px] text-ink-2">{meta}</span> : null}
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        {footer ? (
          <footer className="border-t border-rule bg-paper-2 px-2.5 py-2 font-mono text-[10px] text-ink-3">
            {footer}
          </footer>
        ) : null}
      </motion.section>
    </div>
  );
}

/** Datum rule used between blocks inside a panel. */
export function PanelRule() {
  return <div className="mx-3 border-t border-dashed border-rule" />;
}
