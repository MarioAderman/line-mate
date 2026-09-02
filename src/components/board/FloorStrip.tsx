"use client";

/**
 * The station strip: what each bay, the diagnostics station and the parts van
 * are doing *at this minute of the shift*.
 *
 * Every figure here is measured, not decorative. The progress bar is the live
 * segment the engine scheduled, filled by the store's clock. The blocked bay
 * counts down to the part instead of pretending to work. The queue chips are
 * the jobs actually routed to that bay, numbered by the position the command
 * layer reads — so dropping on chip 2 asks for position 2.
 */
import { formatMinute, type Scenario } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { floorAt, type FloorView } from "@/components/derive";
import { partName, usePopoverAnchor } from "@/components/frame";
import { readWorkItemDrag } from "@/components/story/dragDrop";
import { routeFromDrop } from "@/store/storySlice";
import { Vehicle } from "@/components/vehicles";
import { acceptsHover, canRoute, dropStateFor, type BoardDrag } from "./drag";
import { ProgressBar } from "./ProgressBar";
import { StationQueue } from "./StationQueue";
import {
  FLOOR_STRIP_HEIGHT,
  liveSegment,
  minutesUntil,
  progressLabel,
  queueOrder,
  windowProgress,
} from "./scale";

interface StripProps {
  scenario: Scenario;
  simulation: SimulationResult | null;
  minute: number;
  drag: BoardDrag | null;
  onDragStart(workItemId: string, fromResourceId: string | null): void;
  onDragEnd(): void;
}

const STATUS_TONE: Record<string, { border: string; label: string }> = {
  working: { border: "border-rule-2", label: "text-ink-2" },
  idle: { border: "border-rule", label: "text-ink-3" },
  blocked: { border: "border-alarm", label: "text-alarm" },
  down: { border: "border-alarm", label: "text-alarm" },
};

/**
 * The technician on the job, as a drafting badge — and the handle for the
 * technician inspector: where they are, what they can do, how loaded they are.
 */
function TechBadge({ id, name }: { id: string; name: string }) {
  const anchor = usePopoverAnchor({ kind: "technician", id });
  return (
    <button
      type="button"
      {...anchor}
      aria-label={`${name}, technician`}
      title={name}
      className="grid h-4 w-4 flex-none place-items-center rounded-full border-[1.4px] border-ink bg-sheet font-mono text-[0.5rem] font-semibold leading-none text-ink"
    >
      {name.charAt(0).toUpperCase()}
    </button>
  );
}

function ResourceCell({
  scenario,
  simulation,
  floor,
  resourceId,
  minute,
  drag,
  onDragStart,
  onDragEnd,
}: StripProps & { floor: FloorView; resourceId: string }) {
  const anchor = usePopoverAnchor({ kind: "resource", id: resourceId });
  const resource = scenario.resources.find((r) => r.id === resourceId);
  const bay = floor.bays[resourceId];
  if (!resource || !bay) return null;

  const tone = STATUS_TONE[bay.status] ?? STATUS_TONE.idle;
  const segment = liveSegment(simulation, resourceId, minute);
  const current = bay.current;
  const blockedUntil =
    resource.blockedUntilMinute !== null && resource.blockedUntilMinute > minute
      ? resource.blockedUntilMinute
      : null;
  // A blocked bay is holding one car on the lift; show that car, not "idle".
  const held = queueOrder(bay.queued).find((w) => w.status === "blocked") ?? null;
  const state = dropStateFor(drag, resourceId);

  return (
    <div
      data-station={resourceId}
      data-drop={state}
      onDragOver={(event) => {
        if (acceptsHover(drag, resourceId, event.dataTransfer)) event.preventDefault();
      }}
      onDrop={(event) => {
        const payload = readWorkItemDrag(event.dataTransfer);
        if (!payload) return;
        event.preventDefault();
        onDragEnd();
        if (!canRoute(scenario, payload.workItemId, resourceId)) return;
        routeFromDrop(payload.workItemId, resourceId, 1);
      }}
      className={`flex h-full min-w-0 flex-col rounded-sheet border bg-sheet px-2 py-1.5 transition-opacity ${
        state === "eligible" ? "border-agent" : tone.border
      } ${state === "ineligible" ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        {...anchor}
        aria-label={`${resource.name}: ${bay.statusLabel}${current ? `, ${current.workItem.vehicle}` : ""}`}
        className="flex items-baseline justify-between gap-2 text-left"
      >
        <span className="truncate text-[0.76rem] font-semibold text-ink">{resource.name}</span>
        <span className={`hmi-label shrink-0 text-[0.5rem] ${tone.label}`}>
          {bay.status === "blocked" ? "Blocked" : bay.status === "working" ? "Working" : "Idle"}
        </span>
      </button>

      {/* The job on the station, and how far through it the shift is. */}
      {current && segment ? (
        <>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.68rem] leading-tight">
            <TechBadge id={segment.technicianId} name={current.technicianName} />
            <span className="truncate text-ink">{current.workItem.vehicle}</span>
            <span className="shrink-0 font-mono text-[0.56rem] text-ink-2">ends {current.endsAt}</span>
          </p>
          <ProgressBar
            value={windowProgress(segment.start, segment.end, minute)}
            caption={progressLabel(segment.start, segment.end, minute)}
            label={`${current.workItem.vehicle} on ${resource.name}: ${progressLabel(segment.start, segment.end, minute)}`}
          />
        </>
      ) : blockedUntil !== null ? (
        <>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.68rem] leading-tight">
            <span className="truncate text-ink">{held ? held.vehicle : "No car on the lift"}</span>
            <span className="shrink-0 font-mono text-[0.56rem] text-alarm">
              held · eta {formatMinute(blockedUntil)}
            </span>
          </p>
          <ProgressBar
            hatch
            tone="alarm"
            value={windowProgress(scenario.clock.startMinute, blockedUntil, minute)}
            caption={`${minutesUntil(blockedUntil, minute)} min to part`}
            label={`${resource.name} blocked, ${minutesUntil(blockedUntil, minute)} minutes to the part`}
          />
        </>
      ) : (
        <>
          <p className="mt-1 truncate text-[0.68rem] leading-tight text-ink-3">{bay.statusLabel}</p>
          <ProgressBar value={0} label={`${resource.name} is idle`} />
        </>
      )}

      <div className="mt-auto">
        <StationQueue
          scenario={scenario}
          resourceId={resourceId}
          resourceName={resource.name}
          items={queueOrder(bay.queued)}
          drag={drag}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      </div>
    </div>
  );
}

/**
 * The header of the parts cell. When a part is out it is the inspector handle
 * for the bay that is waiting on it — the van has no resource of its own, so a
 * click asks about the bay whose shift it is holding up.
 */
function PartsHeader({ resourceId, count }: { resourceId: string; count: number }) {
  const anchor = usePopoverAnchor({ kind: "resource", id: resourceId });
  return (
    <button
      type="button"
      {...anchor}
      aria-label={`Parts: ${count} on order, holding up the blocked bay`}
      className="flex items-baseline justify-between gap-2 text-left"
    >
      <span className="truncate text-[0.76rem] font-semibold text-ink">Parts</span>
      <span className="hmi-label shrink-0 text-[0.5rem] text-warn">{count} on order</span>
    </button>
  );
}

/** The van. Not a resource — a countdown the whole shift is waiting on. */
function PartsCell({ scenario, minute }: { scenario: Scenario; minute: number }) {
  const waiting = scenario.resources.filter(
    (r) => r.blockedUntilMinute !== null && r.blockedUntilMinute > minute,
  );
  const first = waiting[0];
  const eta = first?.blockedUntilMinute ?? null;
  const late = waiting.length > 0 && eta !== null && first?.blockingReason;

  return (
    <div
      className={`flex h-full min-w-0 flex-col rounded-sheet border bg-sheet px-2 py-1.5 ${
        late ? "border-warn" : "border-rule"
      }`}
    >
      {late && first ? (
        <PartsHeader resourceId={first.id} count={waiting.length} />
      ) : (
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[0.76rem] font-semibold text-ink">Parts</span>
          <span className="hmi-label shrink-0 text-[0.5rem] text-ink-3">On hand</span>
        </div>
      )}

      {late && eta !== null ? (
        <>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.68rem] leading-tight">
            <Vehicle kind="van" stroke="var(--warn)" fill="var(--sheet)" width={26} />
            <span className="truncate text-ink">{partName(first.blockingReason!)}</span>
            <span className="shrink-0 font-mono text-[0.56rem] text-warn">{formatMinute(eta)}</span>
          </p>
          <ProgressBar
            tone="warn"
            value={windowProgress(scenario.clock.startMinute, eta, minute)}
            caption={`${minutesUntil(eta, minute)} min out`}
            label={`Water pump arrives in ${minutesUntil(eta, minute)} minutes`}
          />
        </>
      ) : (
        <p className="mt-1 truncate text-[0.68rem] leading-tight text-ink-3">Every job has its parts</p>
      )}

      <p className="hmi-label mt-auto pt-1.5 text-[0.48rem]">
        {late ? `for ${first.name}` : "nothing on order"}
      </p>
    </div>
  );
}

export function FloorStrip(props: StripProps) {
  const { scenario, simulation, minute } = props;
  const floor = floorAt(scenario, simulation, minute);
  const bays = scenario.resources.filter((r) => r.type === "bay").map((r) => r.id);
  const stations = scenario.resources.filter((r) => r.type === "station").map((r) => r.id);

  return (
    <section
      aria-label="Floor now"
      style={{
        height: FLOOR_STRIP_HEIGHT,
        gridTemplateColumns: `repeat(${bays.length + stations.length + 1}, minmax(0,1fr))`,
      }}
      className="grid shrink-0 gap-2"
    >
      {[...bays, ...stations].map((id) => (
        <ResourceCell key={id} {...props} floor={floor} resourceId={id} />
      ))}
      <PartsCell scenario={scenario} minute={minute} />
    </section>
  );
}
