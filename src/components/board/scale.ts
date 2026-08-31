"use client";

/**
 * The Board's drawing field is a time scale: 14:15 on the left edge, 18:00 on
 * the right, stretching to whatever width the pane gives it. Everything on the
 * field — blocks, the blocked window, promise flags, the now cursor — is
 * positioned as a percentage of the shift, so nothing needs to be measured to
 * render correctly.
 */
import { useCallback, useRef, useState, type RefCallback } from "react";
import type { Clock } from "@/domain";

/** Fixed geometry of the Board, in px. */
export const LABEL_WIDTH = 118;
export const AXIS_HEIGHT = 44;
export const FLOOR_STRIP_HEIGHT = 88;

/** A block fills most of its lane, within drafting-sensible bounds. */
export const BLOCK_HEIGHT = { height: "56%", minHeight: 44, maxHeight: 66 } as const;

/** Minute of day -> 0..100 across the shift. */
export function minutePercent(minute: number, clock: Clock): number {
  const span = clock.endMinute - clock.startMinute;
  if (span <= 0) return 0;
  const ratio = (minute - clock.startMinute) / span;
  return Math.min(100, Math.max(0, ratio * 100));
}

/** Left/width percentages for a [start, end) window, clipped to the shift. */
export function windowPercent(start: number, end: number, clock: Clock): { left: number; width: number } {
  const left = minutePercent(start, clock);
  const width = Math.max(0, minutePercent(end, clock) - left);
  return { left, width };
}

/** Tick minutes across the shift, every `step` minutes, plus the opening minute. */
export function ticks(clock: Clock, step = 15): number[] {
  const first = Math.ceil(clock.startMinute / step) * step;
  const out: number[] = [];
  if (first !== clock.startMinute) out.push(clock.startMinute);
  for (let minute = first; minute <= clock.endMinute; minute += step) out.push(minute);
  return out;
}

/** Measured width of an element, so blocks can decide how much text fits. */
export function useElementWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback<RefCallback<T>>((node) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const next = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    next.observe(node);
    observer.current = next;
  }, []);

  return [ref, width];
}
