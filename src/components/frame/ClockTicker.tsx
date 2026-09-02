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

export function ClockTicker() {
  const running = useWorkshopStore((s) => s.clockRunning);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => useWorkshopStore.getState().tickClock(), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  return null;
}
