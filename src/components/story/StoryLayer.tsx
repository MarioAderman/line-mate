"use client";

/**
 * The story column: one panel at a time, decided by `store.story`.
 *
 * Calm shows nothing and escalation is the shared frame's alert card, so this
 * layer only owns the last three beats. It is absolutely positioned inside the
 * Shell's content area, which is why it never reaches the header or the
 * live-figures strip.
 *
 * On the board the column sits on the right, over the quiet end of the lanes.
 * On the floor it docks left, over the waiting lot: the plan routes animate
 * around Bay 3 and the exit on the right, and the panel must never cover the
 * thing it is explaining. Every panel is also draggable by its title block
 * (see StoryPanel), so the operator can always move it off something.
 */
import { useRef } from "react";
import { AnimatePresence } from "motion/react";
import { useStory } from "@/store/storySlice";
import { useWorkshopStore } from "@/store/workshopStore";
import { ProposalCard } from "./ProposalCard";
import { ResolvedCard } from "./ResolvedCard";
import { ScenariosPanel } from "./ScenariosPanel";
import { StoryDragBounds } from "./StoryPanel";
import { Toast } from "./Toast";

export function StoryLayer() {
  const story = useStory();
  const view = useWorkshopStore((state) => state.view);
  const bounds = useRef<HTMLDivElement>(null);
  return (
    <>
      <div
        ref={bounds}
        className={`pointer-events-none absolute inset-0 z-30 flex items-start p-4 ${
          view === "floor" ? "justify-start" : "justify-end"
        }`}
        aria-live="polite"
      >
        <StoryDragBounds.Provider value={bounds}>
          {/* mode="wait": the proposal collapses out before the resolved card lands. */}
          <AnimatePresence mode="wait" initial={false}>
            {story === "running" && <ScenariosPanel key="running" />}
            {story === "proposal" && <ProposalCard key="proposal" />}
            {story === "resolved" && <ResolvedCard key="resolved" />}
          </AnimatePresence>
        </StoryDragBounds.Provider>
      </div>
      {/* Fixed to the pane, not to this column, so it clears both docks. */}
      <Toast />
    </>
  );
}
