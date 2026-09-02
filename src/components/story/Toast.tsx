"use client";

/**
 * One transient line, bottom-centre of the drawing field.
 *
 * The only thing that speaks here is an action whose result is invisible on
 * the sheet — copying the agent question to the clipboard. Everything else in
 * Line-Mate reports itself by changing the drawing, which is why this is a
 * single slot and not a notification stack.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FRAME } from "@/components/frame/metrics";

const DISMISS_MS = 3200;

interface ToastState {
  message: string | null;
  /** Bumped on every show so a repeat of the same text re-triggers. */
  seq: number;
  show(message: string): void;
  clear(): void;
}

const useToastStore = create<ToastState>((set) => ({
  message: null,
  seq: 0,
  show: (message) => set((s) => ({ message, seq: s.seq + 1 })),
  clear: () => set({ message: null }),
}));

/** Non-reactive entry point, callable from an event handler. */
export function showToast(message: string): void {
  useToastStore.getState().show(message);
}

export function Toast() {
  const message = useToastStore((s) => s.message);
  const seq = useToastStore((s) => s.seq);
  const clear = useToastStore((s) => s.clear);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(clear, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [message, seq, clear]);

  return (
    <AnimatePresence>
      {message !== null && (
        <motion.p
          key={seq}
          role="status"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
          style={{ bottom: FRAME.live + 16 }}
          className="pointer-events-none fixed left-1/2 z-[60] max-w-[520px] -translate-x-1/2 rounded-sheet border border-ink bg-ink px-3 py-1.5 text-center font-mono text-[0.68rem] leading-snug text-paper-2 shadow-[3px_3px_0_0_var(--rule-2)]"
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
