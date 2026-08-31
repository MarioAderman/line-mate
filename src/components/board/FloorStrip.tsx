"use client";

/**
 * Compact floor strip above the schedule: the three bays, diagnostics and the
 * parts van, each showing what is on it right now. It answers "where is the
 * shop at 14:15" before the eye reaches the time field.
 */
import { formatMinute, type Scenario } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { floorAt, vehicleKind, type FloorView } from "@/components/derive";
import { partName, usePopoverAnchor } from "@/components/frame";
import { Vehicle } from "@/components/vehicles";
import { FLOOR_STRIP_HEIGHT } from "./scale";

const STATUS_TONE: Record<string, { border: string; label: string }> = {
  working: { border: "border-rule-2", label: "text-ink-2" },
  idle: { border: "border-rule", label: "text-ink-3" },
  blocked: { border: "border-alarm", label: "text-alarm" },
  down: { border: "border-alarm", label: "text-alarm" },
};

function ResourceCell({
  scenario,
  floor,
  resourceId,
}: {
  scenario: Scenario;
  floor: FloorView;
  resourceId: string;
}) {
  const anchor = usePopoverAnchor({ kind: "resource", id: resourceId });
  const resource = scenario.resources.find((r) => r.id === resourceId);
  const bay = floor.bays[resourceId];
  if (!resource || !bay) return null;
  const tone = STATUS_TONE[bay.status] ?? STATUS_TONE.idle;
  const current = bay.current;

  return (
    <button
      type="button"
      {...anchor}
      aria-label={`${resource.name}: ${bay.statusLabel}${current ? `, ${current.workItem.vehicle}` : ""}`}
      className={`flex h-full min-w-0 flex-col justify-between rounded-sheet border bg-sheet px-2 py-1.5 text-left ${tone.border}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[0.76rem] font-semibold text-ink">{resource.name}</span>
        <span className={`hmi-label shrink-0 text-[0.5rem] ${tone.label}`}>
          {bay.status === "blocked" ? "Blocked" : bay.status === "working" ? "Working" : "Idle"}
        </span>
      </div>
      {current ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Vehicle kind={vehicleKind(current.workItem.vehicle)} stroke="var(--ink)" fill="var(--sheet)" width={32} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[0.68rem] text-ink">{current.workItem.vehicle}</span>
            <span className="block truncate font-mono text-[0.58rem] text-ink-3">ends {current.endsAt}</span>
          </span>
        </div>
      ) : (
        <p className={`truncate font-mono text-[0.62rem] ${tone.label}`}>{bay.statusLabel}</p>
      )}
    </button>
  );
}

function PartsCell({ scenario, minute }: { scenario: Scenario; minute: number }) {
  const waiting = scenario.resources.filter(
    (r) => r.blockedUntilMinute !== null && r.blockedUntilMinute > minute,
  );
  const late = waiting.length > 0;
  const first = waiting[0];

  return (
    <div
      className={`flex h-full min-w-0 flex-col justify-between rounded-sheet border bg-sheet px-2 py-1.5 ${
        late ? "border-warn" : "border-rule"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[0.76rem] font-semibold text-ink">Parts</span>
        <span className={`hmi-label shrink-0 text-[0.5rem] ${late ? "text-warn" : "text-ink-3"}`}>
          {late ? `${waiting.length} on order` : "On hand"}
        </span>
      </div>
      {late && first?.blockingReason && first.blockedUntilMinute !== null ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <Vehicle kind="van" stroke="var(--warn)" fill="var(--sheet)" width={32} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[0.68rem] text-ink">{partName(first.blockingReason)}</span>
            <span className="block truncate font-mono text-[0.58rem] text-warn">
              eta {formatMinute(first.blockedUntilMinute)} · {first.name}
            </span>
          </span>
        </div>
      ) : (
        <p className="truncate font-mono text-[0.62rem] text-ink-3">Every job has its parts</p>
      )}
    </div>
  );
}

export function FloorStrip({
  scenario,
  simulation,
  minute,
}: {
  scenario: Scenario;
  simulation: SimulationResult | null;
  minute: number;
}) {
  const floor = floorAt(scenario, simulation, minute);
  const cells = scenario.resources.filter((r) => r.type === "bay").map((r) => r.id);
  const stations = scenario.resources.filter((r) => r.type === "station").map((r) => r.id);

  return (
    <section
      aria-label="Floor now"
      style={{
        height: FLOOR_STRIP_HEIGHT,
        gridTemplateColumns: `repeat(${cells.length + stations.length + 1}, minmax(0,1fr))`,
      }}
      className="grid shrink-0 gap-2"
    >
      {[...cells, ...stations].map((id) => (
        <ResourceCell key={id} scenario={scenario} floor={floor} resourceId={id} />
      ))}
      <PartsCell scenario={scenario} minute={minute} />
    </section>
  );
}
