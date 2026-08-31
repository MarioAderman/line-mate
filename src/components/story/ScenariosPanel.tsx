"use client";

/**
 * Beat 3 — the search, made visible.
 *
 * Everything here is read from the store's `exploration` progress: the counter,
 * the best-so-far line and one row per candidate family. Nothing is recomputed
 * and nothing is invented; the rows are the engine's own chunks.
 */
import { motion, useReducedMotion } from "motion/react";
import type { ExplorationRow } from "@/domain";
import { useActiveScenario } from "@/store";
import { useExploration } from "@/store/storySlice";
import { constraintsLine } from "./planCards";
import { StoryPanel } from "./StoryPanel";

function percent(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}

function Row({ row, running }: { row: ExplorationRow; running: boolean }) {
  const reduced = useReducedMotion();
  const done = row.progress >= 1;
  const active = !done && running && row.progress > 0;
  return (
    <li className="px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[12px] leading-tight ${done ? "text-ink" : "text-ink-2"}`}>
          {row.label}
        </span>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            done ? "text-ink" : "text-ink-3"
          }`}
        >
          {row.promisesMet === null ? "—" : `${row.promisesMet} / 6`}
        </span>
      </div>
      <div
        className="mt-1.5 h-[6px] border border-rule bg-paper"
        role="progressbar"
        aria-label={row.label}
        aria-valuenow={Math.round(row.progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="h-full"
          style={{ background: done ? "var(--ink)" : "var(--agent)" }}
          initial={false}
          animate={{ width: `${Math.round(row.progress * 100)}%` }}
          transition={{ duration: reduced ? 0 : 0.18, ease: "linear" }}
        />
      </div>
      {/* One line per row, always: the list must not jump as rows land. */}
      <div className={`mt-1 font-mono text-[10px] ${active ? "text-agent" : "text-ink-3"}`}>
        {row.promisesMetRate !== null
          ? `kept in ${percent(row.promisesMetRate)} of runs`
          : active
            ? "running…"
            : "queued"}
      </div>
    </li>
  );
}

export function ScenariosPanel() {
  const exploration = useExploration();
  const scenario = useActiveScenario();
  const best = exploration.best;
  const running = exploration.status === "running";

  return (
    <StoryPanel
      title="Exploring schedules"
      tone="agent"
      meta={running ? "AGENT · SEARCHING" : "AGENT · DONE"}
      label="Schedule exploration"
      footer={constraintsLine(scenario)}
    >
      <div className="border-b border-rule px-3 py-3">
        <div className="flex items-baseline gap-2">
          <motion.span
            key={exploration.runsExecuted}
            className="font-mono text-[34px] leading-none font-semibold tabular-nums text-ink"
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12 }}
          >
            {exploration.runsExecuted}
          </motion.span>
          <span className="hmi-label">scenarios run</span>
        </div>
        <p className="mt-2 text-[12px] text-ink-2">
          {best ? (
            <>
              best so far{" "}
              <span className="font-mono font-semibold text-ink">
                {best.promisesMet} / {best.promisedTotal}
              </span>{" "}
              in{" "}
              <span className="font-mono font-semibold text-ink">
                {percent(best.promisesMetRate)}
              </span>{" "}
              of runs
            </>
          ) : (
            <span className="text-ink-3">building candidates…</span>
          )}
        </p>
      </div>
      <ul className="divide-y divide-rule" aria-live="polite">
        {exploration.rows.map((row) => (
          <Row key={row.id} row={row} running={running} />
        ))}
      </ul>
    </StoryPanel>
  );
}
