"use client";

/**
 * One resource lane on the time field.
 *
 * Blocks are the engine's segments — nothing is invented here. A blocked
 * window is hatched (an SVG pattern, not a colour wash) and labelled, and a
 * block that breaks its promise is drawn in oxide red *and* carries a mark, so
 * the state never depends on colour alone.
 */
import { motion, useReducedMotion } from "motion/react";
import { formatMinute, type Clock, type ResourceType } from "@/domain";
import type { Lane as LaneModel, LaneBlock } from "@/components/derive";
import { usePopoverAnchor } from "@/components/frame";
import { Vehicle } from "@/components/vehicles";
import { BLOCK_HEIGHT, LABEL_WIDTH, windowPercent } from "./scale";
import { readWorkItemDrag } from "@/components/story/dragDrop";
import { routeFromDrop } from "@/store/storySlice";

interface Props {
  lane: LaneModel;
  type: ResourceType;
  clock: Clock;
  /** Measured px width of the track, used only to decide what text fits. */
  trackWidth: number;
  last: boolean;
}

function Block({
  block,
  clock,
  trackWidth,
}: {
  block: LaneBlock;
  clock: Clock;
  trackWidth: number;
}) {
  const reduced = useReducedMotion();
  const anchor = usePopoverAnchor({ kind: "workItem", id: block.workItemId });
  const { left, width } = windowPercent(block.start, block.end, clock);
  const px = (width / 100) * trackWidth;

  // Fit the label to the block rather than to a fixed pixel ladder: a wide
  // block earns its times and its operation, a narrow one keeps the name whole.
  const times = `${formatMinute(block.start)}–${formatMinute(block.end)}`;
  const showVehicle = px >= 52;
  const showGlyph = px >= 92;
  const chrome = showGlyph ? 44 : 14;
  const showTimes = px >= chrome + block.vehicle.length * 6.8 + 68;
  const textColumn = px - chrome - (showTimes ? 62 : 0);
  const showOperation = showVehicle && textColumn >= block.operation.length * 6;

  return (
    <motion.button
      type="button"
      {...anchor}
      initial={false}
      animate={{ left: `${left}%`, width: `${width}%` }}
      transition={{ duration: reduced ? 0 : 0.35, ease: "easeOut" }}
      style={{ left: `${left}%`, width: `${width}%`, ...BLOCK_HEIGHT }}
      aria-label={`${block.vehicle}, ${block.operation}, ${times}${block.late ? ", misses its promise" : ""}`}
      className={`absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-sheet border border-l-[3px] px-1.5 text-left ${
        block.late ? "border-alarm bg-alarm-wash" : "border-ink bg-sheet"
      }`}
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
          {showOperation && <span className="block truncate text-[0.62rem] text-ink-3">{block.operation}</span>}
        </span>
      )}
      {showTimes && (
        <span className={`shrink-0 font-mono text-[0.6rem] ${block.late ? "text-alarm" : "text-ink-2"}`}>{times}</span>
      )}
    </motion.button>
  );
}

function BlockedWindow({ lane, clock }: { lane: LaneModel; clock: Clock }) {
  const anchor = usePopoverAnchor({ kind: "resource", id: lane.resourceId });
  if (!lane.blocked) return null;
  const { left, width } = windowPercent(lane.blocked.start, lane.blocked.end, clock);
  const patternId = `board-hatch-${lane.resourceId}`;
  return (
    <div
      {...anchor}
      title={lane.blocked.reason}
      style={{ left: `${left}%`, width: `${width}%` }}
      className="absolute inset-y-0 border-x border-alarm"
    >
      <svg className="absolute inset-0 h-full w-full" aria-hidden focusable="false">
        <defs>
          <pattern
            id={patternId}
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="9" stroke="var(--alarm)" strokeWidth="1.2" opacity="0.4" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      <p className="hmi-label absolute left-1.5 top-1.5 text-[0.55rem] text-alarm">
        Blocked · until {formatMinute(lane.blocked.end)}
      </p>
    </div>
  );
}

export function Lane({ lane, type, clock, trackWidth, last }: Props) {
  const anchor = usePopoverAnchor({ kind: "resource", id: lane.resourceId });
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
        <span className="hmi-label text-[0.52rem]">{type === "station" ? "Station" : "Bay"}</span>
      </button>
      <div
        className="relative min-w-0"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-workshop-work-item")) e.preventDefault();
        }}
        onDrop={(e) => {
          const payload = readWorkItemDrag(e.dataTransfer);
          if (!payload) return;
          e.preventDefault();
          routeFromDrop(payload.workItemId, lane.resourceId, 1);
        }}
      >
        <BlockedWindow lane={lane} clock={clock} />
        {lane.blocks.map((block) => (
          <Block key={`${block.workItemId}:${block.start}`} block={block} clock={clock} trackWidth={trackWidth} />
        ))}
      </div>
    </div>
  );
}
