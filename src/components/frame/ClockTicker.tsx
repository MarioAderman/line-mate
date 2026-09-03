"use client";

/**
 * The shift clock. One shift-minute every TICK_MS while the store says the
 * clock is running; every progress bar, countdown and the NOW line derive
 * from `store.playbackMinute` — nobody else keeps time. Mounted only once
 * the cover is dismissed, so a take always opens exactly at 14:15.
 */
import { useEffect } from "react";
import { useWorkshopStore } from "@/store";

/** 1 shift-minute per 2 s: the whole 14:15→18:00 shift plays in 7.5 minutes. */
export const TICK_MS = 2000;

/**
 * Beats where time is allowed to pass. The moment the issue lands the shop
 * freezes at that minute: the manager and the agent look at the same frozen
 * picture through exploration and proposal, and nothing finishes or leaves on
 * its own. Time resumes once the recovery is applied.
 */
const TIME_FLOWS_IN = new Set(["calm", "resolved"]);

export function ClockTicker() {
  const running = useWorkshopStore((s) => s.clockRunning);
  const story = useWorkshopStore((s) => s.story);

  useEffect(() => {
    if (!running || !TIME_FLOWS_IN.has(story)) return;
    const id = window.setInterval(() => useWorkshopStore.getState().tickClock(), TICK_MS);
    return () => window.clearInterval(id);
  }, [running, story]);

  return null;
}
