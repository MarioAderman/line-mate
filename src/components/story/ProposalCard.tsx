"use client";

/**
 * Beat 4 — the evidence-backed plan, still unapplied.
 *
 * The plan is the exploration's winning candidate, drawn as one card per idea.
 * A routing card can be dragged onto a lane or a bay, or re-targeted from its
 * own picker for anyone driving by keyboard; either way the change goes out as
 * `route_work_item`, attributed to the human, before the plan is applied.
 */
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Vehicle } from "@/components/vehicles";
import { useActiveScenario, useWorkshopStore } from "@/store";
import { applyAndNotify, useExploration, useProposedPlan } from "@/store/storySlice";
import { eligibleResourceIds, planCards, type PlanCard } from "./planCards";
import { writeWorkItemDrag } from "./dragDrop";
import { StoryPanel } from "./StoryPanel";

export interface ProposalCardProps {
  /** Defaults to `route_work_item` on the live world, as the human. */
  onRoute?: (workItemId: string, resourceId: string | null) => void;
  onApply?: () => void;
  onLater?: () => void;
}

function defaultRoute(workItemId: string, resourceId: string | null): void {
  useWorkshopStore
    .getState()
    .run("route_work_item", { workItemId, resourceId, position: 1 }, "human");
}

function ChangeCard({
  card,
  index,
  onRoute,
}: {
  card: PlanCard;
  index: number;
  onRoute: (workItemId: string, resourceId: string | null) => void;
}) {
  const scenario = useActiveScenario();
  const reduced = useReducedMotion();
  const draggable = card.workItemId !== null;
  const options = card.workItemId ? eligibleResourceIds(scenario, card.workItemId) : [];

  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.18, delay: reduced ? 0 : index * 0.05 }}
    >
      {/* The card itself is the drag source — not Motion's own pointer drag. */}
      <div
        className={`border border-dashed border-agent bg-agent-wash px-2.5 py-2 ${
          draggable ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{ borderRadius: "var(--radius-sheet)" }}
        draggable={draggable}
        onDragStart={(event) => {
          if (!card.workItemId) return;
          writeWorkItemDrag(event.dataTransfer, {
            workItemId: card.workItemId,
            fromResourceId: card.resourceId,
          });
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {card.vehicleKind && (
              <Vehicle kind={card.vehicleKind} stroke="var(--ink)" fill="var(--sheet)" width={34} />
            )}
            <span className="text-[12px] leading-tight font-medium text-ink">{card.title}</span>
          </div>
          <span className="shrink-0 border border-rule-2 bg-sheet px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-2">
            {card.timeLabel}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink-2">{card.detail}</p>
        {draggable && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <label className="hmi-label !text-[9px]" htmlFor={`route-${card.id}`}>
              Bay
            </label>
            <select
              id={`route-${card.id}`}
              className="hmi-select !w-auto !py-0.5 !text-[11px]"
              value={card.resourceId ?? ""}
              onChange={(event) =>
                onRoute(
                  card.workItemId as string,
                  event.target.value === "" ? null : event.target.value,
                )
              }
            >
              <option value="">any open bay</option>
              {options.map((id) => (
                <option key={id} value={id}>
                  {scenario.resources.find((r) => r.id === id)?.name ?? id}
                </option>
              ))}
            </select>
            <span className="font-mono text-[9px] text-ink-3">or drag onto a lane</span>
          </div>
        )}
      </div>
    </motion.li>
  );
}

export function ProposalCard({ onRoute, onApply, onLater }: ProposalCardProps = {}) {
  const plan = useProposedPlan();
  const scenario = useActiveScenario();
  const best = useExploration().best;
  const [collapsed, setCollapsed] = useState(false);
  const route = onRoute ?? defaultRoute;

  if (!plan) return null;
  const cards = planCards(plan, scenario);
  const headline = best
    ? `${best.promisesMet} / ${best.promisedTotal} in ${Math.round(best.promisesMetRate * 100)} % of runs`
    : "not scored yet";

  if (collapsed) {
    return (
      <StoryPanel title="Proposed plan" meta={headline} label="Proposed plan, collapsed">
        <div className="px-3 py-3">
          <button type="button" className="hmi-button w-full" onClick={() => setCollapsed(false)}>
            Reopen plan
          </button>
        </div>
      </StoryPanel>
    );
  }

  return (
    <StoryPanel title="Proposed plan" tone="agent" meta={headline} label="Proposed plan">
      <ul className="flex flex-col gap-2 px-3 py-3">
        {cards.map((card, index) => (
          <ChangeCard key={card.id} card={card} index={index} onRoute={route} />
        ))}
      </ul>
      <div className="flex gap-2 border-t border-rule px-3 py-2.5">
        <button
          type="button"
          className="hmi-button hmi-button--primary flex-1 !text-[11px]"
          onClick={() => (onApply ? onApply() : applyAndNotify(plan))}
        >
          Apply &amp; notify team
        </button>
        <button
          type="button"
          className="hmi-button !text-[11px]"
          onClick={() => (onLater ? onLater() : setCollapsed(true))}
        >
          Later
        </button>
      </div>
    </StoryPanel>
  );
}
