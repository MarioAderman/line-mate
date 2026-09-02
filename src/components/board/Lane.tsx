"use client";

/**
 * One resource lane on the time field.
 *
 * Blocks are the engine's segments — nothing is invented here. Each block wears
 * its own progress along its bottom edge, so the shift visibly runs through the
 * drawing; a finished block steps back rather than disappearing. A blocked
 * window is hatched (an SVG pattern, not a colour wash) and labelled, and a
 * block that breaks its promise is drawn in oxide red *and* carries a mark, so
 * the state never depends on colour alone.
 *
 * Blocks are draggable. While one is in the air the lanes that can actually run
 * it are lit and the rest step back, and a drop goes to `routeFromDrop` — which
 * routes the world (and makes the store re-simulate, so the ETA answers the
 * drop) or edits the proposal draft, depending on the beat.
 */
import { type DragEvent } from "react";
import { formatMinute, type Clock, type ResourceType, type Scenario } from "@/domain";
import type { Lane as LaneModel, LaneBlock } from "@/components/derive";
import { usePopoverAnchor } from "@/components/frame";
import { readWorkItemDrag, writeWorkItemDrag } from "@/components/story/dragDrop";
import { routeFromDrop } from "@/store/storySlice";
import { Vehicle } from "@/components/vehicles";
import { acceptsHover, canRoute, dropStateFor, type BoardDrag, type DropState } from "./drag";
import { BLOCK_HEIGHT, LABEL_WIDTH, minutesUntil, windowPercent, windowProgress } from "./scale";

interface Props {
  lane: LaneModel;
  type: ResourceType;
  clock: Clock;
  scenario: Scenario;
  /** The shift clock, from `store.playbackMinute`. */
  minute: number;
  /** Share of the shift this resource is busy, from the last run. */
  utilization: number | null;
  /** Measured px width of the track, used only to decide what text fits. */
  trackWidth: number;
  last: boolean;
  drag: BoardDrag | null;
  onDragStart(workItemId: string, fromResourceId: string | null): void;
  onDragEnd(): void;
}

function Block({
  block,
  clock,
  minute,
  trackWidth,
  resourceId,
  pinned,
  drag,
  onDragStart,
  onDragEnd,
}: {
  block: LaneBlock;
  clock: Clock;
  minute: number;
  trackWidth: number;
  resourceId: string;
  /** Someone routed this job to this lane; the scheduler did not choose it. */
  pinned: boolean;
  drag: BoardDrag | null;
  onDragStart(workItemId: string, fromResourceId: string | null): void;
  onDragEnd(): void;
}) {
  const anchor = usePopoverAnchor({ kind: "workItem", id: block.workItemId });
  const { left, width } = windowPercent(block.start, block.end, clock);
  const px = (width / 100) * trackWidth;

  const progress = windowProgress(block.start, block.end, minute);
  const done = minute >= block.end;
  const running = !done && minute >= block.start;
  const lifted = drag?.workItemId === block.workItemId;

  // Fit the label to the block rather than to a fixed pixel ladder: a wide
  // block earns its times and its operation, a narrow one keeps the name whole.
  const times = `${formatMinute(block.start)}–${formatMinute(block.end)}`;
  const showVehicle = px >= 52;
  const showGlyph = px >= 92;
  const chrome = showGlyph ? 44 : 14;
  const showTimes = px >= chrome + block.vehicle.length * 6.8 + 68;
  const textColumn = px - chrome - (showTimes ? 62 : 0);
  const showOperation = showVehicle && textColumn >= block.operation.length * 6;
  // The queue chips carry the numbering; a block only says who put it here.
  const caption = running
    ? `${minutesUntil(block.end, minute)} min left`
    : pinned
      ? "pinned here"
      : block.operation;

  return (
    <button
      type="button"
      {...anchor}
      draggable
      onDragStart={(event: DragEvent<HTMLButtonElement>) => {
        writeWorkItemDrag(event.dataTransfer, {
          workItemId: block.workItemId,
          fromResourceId: resourceId,
        });
        onDragStart(block.workItemId, resourceId);
      }}
      onDragEnd={onDragEnd}
      data-block={block.workItemId}
      data-running={running ? "" : undefined}
      data-done={done ? "" : undefined}
      style={{ left: `${left}%`, width: `${width}%`, ...BLOCK_HEIGHT }}
      aria-label={`${block.vehicle}, ${block.operation}, ${times}${
        block.late ? ", misses its promise" : ""
      }${running ? `, ${minutesUntil(block.end, minute)} minutes left` : done ? ", finished" : ""}`}
      className={`absolute top-1/2 flex -translate-y-1/2 cursor-grab items-center gap-1.5 overflow-hidden rounded-sheet border border-l-[3px] px-1.5 text-left transition-[left,width,opacity] duration-300 ease-out ${
        block.late ? "border-alarm bg-alarm-wash" : "border-ink bg-sheet"
      } ${pinned && !block.late ? "border-agent shadow-[2px_2px_0_0_var(--agent)]" : ""} ${
        done ? "opacity-55" : ""
      } ${lifted ? "opacity-40" : ""}`}
    >
      {showGlyph && (
        <Vehicle
          kind={block.kind}
          stroke={block.late ? "var(--alarm)" : "var(--ink)"}
          fill="var(--sheet)"
          width={30}
        />
      )}
      {showVehicle && (
        <span className="min-w-0 flex-1 leading-tight">
          <span
            className={`flex items-center gap-1 truncate text-[0.7rem] font-medium ${
              block.late ? "text-alarm" : "text-ink"
            }`}
          >
            {block.late && (
              <span aria-hidden className="font-mono font-semibold">
                !
              </span>
            )}
            {block.vehicle}
          </span>
          {showOperation && (
            <span
              className={`block truncate text-[0.62rem] ${
                block.late
                  ? "font-mono text-alarm"
                  : running || pinned
                    ? "font-mono text-agent"
                    : "text-ink-3"
              }`}
            >
              {caption}
            </span>
          )}
        </span>
      )}
      {showTimes && (
        <span className={`shrink-0 font-mono text-[0.6rem] ${block.late ? "text-alarm" : "text-ink-2"}`}>
          {times}
        </span>
      )}

      {/* The shift running through the block, along its bottom edge. */}
      <span
        aria-hidden
        style={{ width: `${progress * 100}%` }}
        className={`absolute bottom-0 left-0 h-[4px] transition-[width] duration-500 ease-linear ${
          block.late ? "bg-alarm" : running ? "bg-agent" : "bg-ink"
        }`}
      />
    </button>
  );
}

function BlockedWindow({ lane, clock, minute }: { lane: LaneModel; clock: Clock; minute: number }) {
  const anchor = usePopoverAnchor({ kind: "resource", id: lane.resourceId });
  if (!lane.blocked) return null;
  const { left, width } = windowPercent(lane.blocked.start, lane.blocked.end, clock);
  const patternId = `board-hatch-${lane.resourceId}`;
  const remaining = minutesUntil(lane.blocked.end, minute);
  return (
    <div
      {...anchor}
      title={lane.blocked.reason}
      style={{ left: `${left}%`, width: `${width}%` }}
      className="absolute inset-y-0 border-x border-alarm"
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
        <defs>
          <pattern id={patternId} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="9" stroke="var(--alarm)" strokeWidth="1.2" opacity="0.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <p className="hmi-label absolute left-1.5 top-1.5 text-[0.55rem] text-alarm">
        {remaining > 0 ? `${remaining} min to part` : `Cleared ${formatMinute(lane.blocked.end)}`}
      </p>
    </div>
  );
}

const TRACK_TONE: Record<DropState, string> = {
  none: "",
  eligible: "bg-agent-wash",
  ineligible: "opacity-40",
  source: "",
};

export function Lane({
  lane,
  type,
  clock,
  scenario,
  minute,
  utilization,
  trackWidth,
  last,
  drag,
  onDragStart,
  onDragEnd,
}: Props) {
  const anchor = usePopoverAnchor({ kind: "resource", id: lane.resourceId });
  const state = dropStateFor(drag, lane.resourceId);
  const blockedNow = lane.blocked !== null && lane.blocked.end > minute;
  const percent = utilization === null ? null : Math.round(utilization * 100);

  // Jobs someone routed to this lane, so a human or agent decision is visible
  // on the drawing itself and not only in the change list.
  const pinned = new Set(
    scenario.workItems.filter((w) => w.route.resourceId === lane.resourceId).map((w) => w.id),
  );

  return (
    <div
      className={`grid min-h-0 flex-1 ${last ? "" : "border-b border-rule"}`}
      style={{ gridTemplateColumns: `${LABEL_WIDTH}px minmax(0,1fr)` }}
    >
      <button
        type="button"
        {...anchor}
        className="flex flex-col justify-center border-r border-rule-2 px-3 text-left"
      >
        <span className="text-[0.82rem] font-semibold leading-tight text-ink">{lane.name}</span>
        <span className={`hmi-label text-[0.5rem] ${blockedNow ? "text-alarm" : ""}`}>
          {blockedNow && lane.blocked
            ? `Blocked · ${formatMinute(lane.blocked.end)}`
            : `${type === "station" ? "Station" : "Bay"}${percent === null ? "" : ` · ${percent}%`}`}
        </span>
        {/* Utilisation of the whole shift, as a ruled dimension under the name. */}
        <span
          aria-hidden
          className="mt-1 block h-[3px] w-full border border-rule bg-paper"
        >
          <span
            className={`block h-full ${blockedNow ? "bg-alarm" : "bg-ink-3"}`}
            style={{ width: `${percent ?? 0}%` }}
          />
        </span>
      </button>

      <div
        data-lane={lane.resourceId}
        data-drop={state}
        className={`relative min-w-0 transition-opacity ${TRACK_TONE[state]}`}
        onDragOver={(event) => {
          if (acceptsHover(drag, lane.resourceId, event.dataTransfer)) event.preventDefault();
        }}
        onDrop={(event) => {
          const payload = readWorkItemDrag(event.dataTransfer);
          if (!payload) return;
          event.preventDefault();
          onDragEnd();
          // The payload is only readable now, so this is where a drop from any
          // stream is judged — the Board never asks for a route the command
          // layer would refuse.
          if (!canRoute(scenario, payload.workItemId, lane.resourceId)) return;
          routeFromDrop(payload.workItemId, lane.resourceId, 1);
        }}
      >
        {state === "eligible" && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-2 left-1 right-1 border border-dashed border-agent"
          />
        )}
        <BlockedWindow lane={lane} clock={clock} minute={minute} />
        {lane.blocks.map((block) => (
          <Block
            key={`${block.workItemId}:${block.start}`}
            block={block}
            clock={clock}
            minute={minute}
            trackWidth={trackWidth}
            resourceId={lane.resourceId}
            pinned={pinned.has(block.workItemId)}
            drag={drag}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  );
}
