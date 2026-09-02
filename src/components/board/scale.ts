"use client";

/**
 * The Board's drawing field is a time scale: 14:15 on the left edge, 18:00 on
 * the right, stretching to whatever width the pane gives it. Everything on the
 * field — blocks, the blocked window, promise flags, the now cursor — is
 * positioned as a percentage of the shift, so nothing needs to be measured to
 * render correctly.
 */
import { useCallback, useRef, useState, type RefCallback } from "react";
import type { Clock, WorkItem } from "@/domain";
import type { Segment, SimulationResult } from "@/simulation";

/** Fixed geometry of the Board, in px. */
export const LABEL_WIDTH = 118;
export const AXIS_HEIGHT = 44;
export const FLOOR_STRIP_HEIGHT = 104;

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

/* ------------------------------------------------- time that can be seen */

/**
 * Progress through a [start, end) window at `minute`, clamped to 0..1.
 * The single "now" is `store.playbackMinute`; nothing here keeps its own clock.
 */
export function windowProgress(start: number, end: number, minute: number): number {
  const span = end - start;
  if (span <= 0) return minute >= end ? 1 : 0;
  return Math.min(1, Math.max(0, (minute - start) / span));
}

/** Whole minutes from `minute` until `target`, never negative. */
export function minutesUntil(target: number, minute: number): number {
  return Math.max(0, Math.round(target - minute));
}

/** Minutes a job has been running, clamped to the window. */
export function minutesElapsed(start: number, end: number, minute: number): number {
  return Math.min(Math.round(end - start), Math.max(0, Math.round(minute - start)));
}

/**
 * The caption above a progress bar: "26 / 45 min" while there is a way to go,
 * "4 min left" in the last stretch, "done" once the window has closed.
 */
export function progressLabel(start: number, end: number, minute: number): string {
  const total = Math.round(end - start);
  const remaining = minutesUntil(end, minute);
  if (remaining === 0) return "done";
  if (remaining <= 5) return `${remaining} min left`;
  return `${minutesElapsed(start, end, minute)} / ${total} min`;
}

/** The segment occupying a resource at `minute`, straight from the engine. */
export function liveSegment(
  result: SimulationResult | null,
  resourceId: string,
  minute: number,
): Segment | null {
  if (!result) return null;
  return (
    result.segments.find((s) => s.resourceId === resourceId && s.start <= minute && s.end > minute) ??
    null
  );
}

/**
 * The queue of a bay in the order the commands read it: pinned position first,
 * then priority, then id. The numbers on the chips are these positions, and
 * dropping on chip N asks for exactly that position.
 */
export function queueOrder(items: WorkItem[]): WorkItem[] {
  return [...items].sort(
    (a, b) =>
      (a.route.position ?? 99) - (b.route.position ?? 99) ||
      a.priority - b.priority ||
      (a.id < b.id ? -1 : 1),
  );
}
