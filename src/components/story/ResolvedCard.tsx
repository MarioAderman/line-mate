"use client";

/**
 * Beat 5 — the shift is back on plan and the team has been told.
 *
 * The promise count comes from the simulation of the active scenario and the
 * channel chips come from the posted `ShiftNote`. Nothing is sent anywhere:
 * Slack, email and SMS are rendered state, exactly as the scope says.
 */
import { motion, useReducedMotion } from "motion/react";
import type { ShiftNote } from "@/domain";
import { useActiveScenario, useActiveSimulation } from "@/store";
import { DEFAULT_NOTE_TEXT, NOTE_CHANNELS, NOTE_RECIPIENTS, useLatestNote, useProposedPlan } from "@/store/storySlice";
import { noteChips, textedCustomerIds } from "./planCards";
import { StoryPanel } from "./StoryPanel";

/**
 * TODO(engine): drops out once `post_shift_note` exists — until then the panel
 * shows the note the beat tried to post rather than an empty card.
 */
const PENDING_NOTE: ShiftNote = {
  id: "NOTE-PENDING",
  at: 0,
  author: "human",
  scenarioId: "",
  text: DEFAULT_NOTE_TEXT,
  channels: NOTE_CHANNELS,
  recipients: NOTE_RECIPIENTS,
};

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
  const note = useLatestNote() ?? PENDING_NOTE;
  const plan = useProposedPlan();
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const promisesMet = simulation?.totals.promisesMet ?? 0;
  const promisedTotal =
    simulation?.totals.promisedTotal ?? scenario.workItems.filter((w) => w.dueMinute !== null).length;
  const customers = plan ? textedCustomerIds(plan, scenario).length : 0;
  const chips = noteChips(note, customers);
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
      </div>

      <blockquote className="mx-3 mb-3 border-l-2 border-ink bg-paper-2 px-2.5 py-2 text-[11px] leading-snug text-ink-2">
        {note.text}
      </blockquote>
    </StoryPanel>
  );
}
