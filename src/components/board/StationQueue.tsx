"use client";

/**
 * A bay's queue as numbered chips, with a dashed slot at the end.
 *
 * The number on a chip is the queue position the command layer reads, so
 * dropping a job on chip 2 asks for exactly `position: 2` — the gesture and the
 * command say the same thing. The dashed slot is the "put it last" target and,
 * on an empty bay, the only thing that says a drop is possible at all.
 */
import { type DragEvent } from "react";
import type { Scenario, WorkItem } from "@/domain";
import { usePopoverAnchor } from "@/components/frame";
import { writeWorkItemDrag, readWorkItemDrag } from "@/components/story/dragDrop";
import { routeFromDrop } from "@/store/storySlice";
import { acceptsHover, canRoute, type BoardDrag } from "./drag";

interface Props {
  scenario: Scenario;
  resourceId: string;
  resourceName: string;
  /** Already in queue order — see `queueOrder`. */
  items: WorkItem[];
  drag: BoardDrag | null;
  onDragStart(workItemId: string, fromResourceId: string | null): void;
  onDragEnd(): void;
}

function Chip({
  scenario,
  item,
  position,
  resourceId,
  resourceName,
  drag,
  onDragStart,
  onDragEnd,
}: {
  scenario: Scenario;
  item: WorkItem;
  position: number;
  resourceId: string;
  resourceName: string;
  drag: BoardDrag | null;
  onDragStart(workItemId: string, fromResourceId: string | null): void;
  onDragEnd(): void;
}) {
  const anchor = usePopoverAnchor({ kind: "workItem", id: item.id });
  const lifted = drag?.workItemId === item.id;
  const open = drag !== null && !lifted && dropOpen(drag, resourceId);

  return (
    <button
      type="button"
      {...anchor}
      draggable
      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
        writeWorkItemDrag(event.dataTransfer, { workItemId: item.id, fromResourceId: resourceId });
        onDragStart(item.id, resourceId);
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (!lifted && acceptsHover(drag, resourceId, event.dataTransfer)) event.preventDefault();
      }}
      onDrop={(event) => {
        const payload = readWorkItemDrag(event.dataTransfer);
        if (!payload || payload.workItemId === item.id) return;
        event.preventDefault();
        event.stopPropagation();
        onDragEnd();
        if (!canRoute(scenario, payload.workItemId, resourceId)) return;
        routeFromDrop(payload.workItemId, resourceId, position);
      }}
      data-queue-chip={item.id}
      aria-label={`${item.vehicle}, position ${position} in the ${resourceName} queue`}
      title={`${item.vehicle} · ${item.name}`}
      className={`grid h-[18px] w-[18px] flex-none cursor-grab place-items-center border font-mono text-[0.56rem] leading-none transition-colors ${
        lifted
          ? "border-agent bg-agent-wash text-agent opacity-60"
          : open
            ? "border-agent bg-agent-wash text-agent"
            : item.status === "blocked"
              ? "border-alarm bg-alarm-wash text-alarm"
              : "border-rule-2 bg-paper-2 text-ink-2"
      }`}
    >
      {position}
    </button>
  );
}

/** Highlight only: an unknown drag is welcomed but not advertised. */
function dropOpen(drag: BoardDrag | null, resourceId: string): boolean {
  return drag !== null && drag.eligible.includes(resourceId);
}

export function StationQueue({
  scenario,
  resourceId,
  resourceName,
  items,
  drag,
  onDragStart,
  onDragEnd,
}: Props) {
  const open = dropOpen(drag, resourceId);
  const last = items.length + 1;

  return (
    <ul className="mt-1.5 flex items-center gap-1" aria-label={`${resourceName} queue`}>
      {items.map((item, index) => (
        <li key={item.id} className="flex">
          <Chip
            scenario={scenario}
            item={item}
            position={index + 1}
            resourceId={resourceId}
            resourceName={resourceName}
            drag={drag}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        </li>
      ))}
      <li className="flex">
        <span
          data-queue-slot={resourceId}
          onDragOver={(event) => {
            if (acceptsHover(drag, resourceId, event.dataTransfer)) event.preventDefault();
          }}
          onDrop={(event) => {
            const payload = readWorkItemDrag(event.dataTransfer);
            if (!payload) return;
            event.preventDefault();
            event.stopPropagation();
            onDragEnd();
            if (!canRoute(scenario, payload.workItemId, resourceId)) return;
            routeFromDrop(payload.workItemId, resourceId, last);
          }}
          title={
            open
              ? `Drop to send this job to ${resourceName}, position ${last}`
              : `Drag a job here to route it to ${resourceName}`
          }
          className={`grid h-[18px] w-[18px] place-items-center border border-dashed font-mono text-[0.56rem] leading-none transition-colors ${
            open ? "border-agent bg-agent-wash text-agent" : "border-rule-2 text-ink-3"
          }`}
        >
          +
        </span>
      </li>
      {drag !== null && !open && (
        <li className="hmi-label pl-1 text-[0.48rem] text-ink-3">no fit</li>
      )}
    </ul>
  );
}
