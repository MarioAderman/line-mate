"use client";

/**
 * The right-hand story column: one panel at a time, decided by `store.story`.
 *
 * Calm shows nothing and escalation is the shared frame's alert card, so this
 * layer only owns the last three beats. It is absolutely positioned inside the
 * Shell's content area, which is why it never reaches the header or the
 * live-figures strip.
 */
import { AnimatePresence } from "motion/react";
import { useStory } from "@/store/storySlice";
import { ProposalCard } from "./ProposalCard";
import { ResolvedCard } from "./ResolvedCard";
import { ScenariosPanel } from "./ScenariosPanel";

export function StoryLayer() {
  const story = useStory();
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-start justify-end p-4"
      aria-live="polite"
    >
      {/* mode="wait": the proposal collapses out before the resolved card lands. */}
      <AnimatePresence mode="wait" initial={false}>
        {story === "running" && <ScenariosPanel key="running" />}
        {story === "proposal" && <ProposalCard key="proposal" />}
        {story === "resolved" && <ResolvedCard key="resolved" />}
      </AnimatePresence>
    </div>
  );
}
