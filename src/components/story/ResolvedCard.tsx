"use client";

/**
 * Beat 5 — the shift is back on plan and the team has been told.
 *
 * The promise count comes from the simulation of the active scenario and the
 * channel chips come from the posted `ShiftNote`. Nothing is sent anywhere:
 * Slack, email and SMS are rendered state, exactly as the scope says.
 */
import { motion, useReducedMotion } from "motion/react";
import { useActiveScenario, useActiveSimulation } from "@/store";
import { useDraftPlan, useLatestNote } from "@/store/storySlice";
import { noteChips, textedCustomerIds } from "./planCards";
import { StoryPanel } from "./StoryPanel";

function CheckMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none" }}>
      <path
        d="M3 8.5 L6.5 12 L13 4"
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinecap="square"
      />
    </svg>
  );
}

export function ResolvedCard() {
  const reduced = useReducedMotion();
  // Only a note that was really stored may be shown: the chips are a claim
  // about the world, not decoration.
  const note = useLatestNote();
  const plan = useDraftPlan();
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const promisesMet = simulation?.totals.promisesMet ?? 0;
  const promisedTotal =
    simulation?.totals.promisedTotal ?? scenario.workItems.filter((w) => w.dueMinute !== null).length;
  const customers = plan ? textedCustomerIds(plan, scenario).length : 0;
  const chips = note ? noteChips(note, customers) : [];
  const overtime = scenario.constraints.overtimeAllowed ? "overtime allowed" : "no overtime";

  return (
    <StoryPanel title="Issue resolved" meta={`${promisesMet} / ${promisedTotal}`} label="Issue resolved">
      <div className="flex items-start gap-2 border-b border-rule px-3 py-3">
        <CheckMark />
        <p className="text-[13px] leading-snug text-ink">
          All {promisedTotal} promises back on track ·{" "}
          <span className="text-ink-2">{overtime}</span>
        </p>
      </div>

      {note === null ? (
        <p className="px-3 py-2.5 text-[11px] leading-snug text-ink-2">
          The shift note was not stored, so the team has not been notified.
        </p>
      ) : (
      <div className="px-3 py-2.5">
        <h3 className="hmi-label">Team notified</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {chips.map((chip, index) => (
            <motion.li
              key={chip.channel}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduced ? 0 : 0.18, delay: reduced ? 0 : 0.1 + index * 0.08 }}
              className="flex items-center gap-2 border border-rule bg-paper-2 px-2 py-1"
              style={{ borderRadius: "var(--radius-sheet)" }}
            >
              <span className="hmi-label !text-[9px] !text-ink-2">{chip.label}</span>
              <span className="font-mono text-[11px] text-ink">{chip.detail}</span>
              <span className="ml-auto">
                <CheckMark />
              </span>
            </motion.li>
          ))}
        </ul>
        <blockquote className="mt-2 border-l-2 border-ink bg-paper-2 px-2.5 py-2 text-[11px] leading-snug text-ink-2">
          {note.text}
        </blockquote>
      </div>
      )}
    </StoryPanel>
  );
}
