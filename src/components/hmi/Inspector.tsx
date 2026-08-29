"use client";

import { formatMinute, type Scenario, type WorkItem } from "@/domain";
import type { SimulationResult } from "@/simulation";
import { useWorkshopStore } from "@/store";
import { money, workMinutes, type FloorView } from "./floor";

interface Props {
  scenario: Scenario;
  simulation: SimulationResult | null;
  floor: FloorView;
}

export function Inspector({ scenario, simulation, floor }: Props) {
  const selection = useWorkshopStore((s) => s.selection);
  const lastResult = useWorkshopStore((s) => s.lastResult);

  return (
    <aside className="hmi-panel flex min-h-0 min-w-0 flex-col" aria-label="Inspector">
      <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
        <span className="hmi-label">Inspector</span>
        {selection && <span className="font-mono text-xs text-porcelain-dim">{selection.id}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 text-sm">
        {!selection && (
          <p className="text-porcelain-dim">
            Select a bay, a technician, or a waiting vehicle. Drag a vehicle onto a bay to route it —
            the agent sees the same change through its tools.
          </p>
        )}
        {selection?.kind === "resource" && (
          <ResourceDetail scenario={scenario} simulation={simulation} floor={floor} id={selection.id} />
        )}
        {selection?.kind === "workItem" && (
          <WorkItemDetail scenario={scenario} simulation={simulation} id={selection.id} />
        )}
        {selection?.kind === "technician" && <TechnicianDetail scenario={scenario} simulation={simulation} id={selection.id} />}
      </div>
      {lastResult && !lastResult.ok && (
        <p role="alert" className="border-t border-coral/60 bg-coral/10 px-3 py-2 text-xs text-coral">
          {lastResult.error}
        </p>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1">
      <dt className="text-porcelain-dim">{label}</dt>
      <dd className="text-right font-mono text-xs">{value}</dd>
    </div>
  );
}

function ResourceDetail({ scenario, simulation, floor, id }: Props & { id: string }) {
  const run = useWorkshopStore((s) => s.run);
  const resource = scenario.resources.find((r) => r.id === id);
  if (!resource) return null;
  const view = floor.bays[id];
  const stat = simulation?.resources.find((r) => r.resourceId === id);
  return (
    <>
      <h2 className="font-display text-xl font-semibold uppercase tracking-wider">{resource.name}</h2>
      <p className={`mb-2 text-xs ${view.status === "blocked" ? "text-coral" : "text-porcelain-dim"}`}>
        {view.statusLabel}
        {resource.blockingReason && view.status === "blocked" ? ` — ${resource.blockingReason}` : ""}
      </p>
      <dl>
        <Row label="Type" value={resource.type} />
        <Row label="Now" value={view.current ? `${view.current.workItem.vehicle} · ${view.current.technicianName}` : "—"} />
        <Row label="Queued here" value={view.queued.map((w) => w.vehicle).join(", ") || "—"} />
        <Row label="Utilisation" value={stat ? `${Math.round(stat.utilization * 100)}%` : "run to see"} />
        <Row label="Busy / blocked" value={stat ? `${stat.busyMinutes}m / ${stat.blockedMinutes}m` : "—"} />
        <Row label="Queue peak" value={stat ? stat.queuePeak : "—"} />
        <Row label="Cost / h" value={money(resource.costPerHour)} />
      </dl>
      {resource.status === "blocked" && (
        <button
          type="button"
          className="hmi-button mt-3 w-full"
          onClick={() =>
            run("update_resource", { resourceId: id, scenarioId: scenario.id, changes: { status: "idle" } }, "human")
          }
        >
          Mark part arrived · release bay
        </button>
      )}
    </>
  );
}

function WorkItemDetail({ scenario, simulation, id }: { scenario: Scenario; simulation: SimulationResult | null; id: string }) {
  const run = useWorkshopStore((s) => s.run);
  const item = scenario.workItems.find((w) => w.id === id);
  if (!item) return null;
  const outcome = simulation?.workItems.find((w) => w.workItemId === id);
  const eligible = scenario.resources.filter((r) => item.steps.some((s) => s.requiredResourceType === r.type));

  const route = (patch: Partial<WorkItem["route"]>) =>
    run(
      "route_work_item",
      { workItemId: id, scenarioId: scenario.id, resourceId: item.route.resourceId, position: item.route.position, ...patch },
      "human",
    );

  return (
    <>
      <h2 className="font-display text-xl font-semibold uppercase tracking-wider">{item.vehicle}</h2>
      <p className="mb-2 text-xs text-porcelain-dim">{item.name}</p>
      <dl>
        <Row
          label="Promise"
          value={
            item.dueMinute === null ? (
              "walk-in"
            ) : (
              <span className={outcome?.onTime === false ? "text-coral" : outcome?.onTime ? "text-coolant" : "text-amber"}>
                {formatMinute(item.dueMinute)}
                {outcome ? (outcome.onTime ? " · kept" : ` · late ${outcome.lateMinutes}m`) : ""}
              </span>
            )
          }
        />
        <Row label="Arrived" value={formatMinute(item.arrivalMinute)} />
        <Row label="Work" value={`${workMinutes(item)}m in ${item.steps.length} step${item.steps.length > 1 ? "s" : ""}`} />
        <Row label="Revenue" value={money(item.revenue)} />
        <Row
          label="Last run"
          value={
            outcome
              ? outcome.completionMinute !== null
                ? `${formatMinute(outcome.startMinute!)} → ${formatMinute(outcome.completionMinute)}`
                : "unfinished"
              : "—"
          }
        />
      </dl>
      <ol className="mt-2 space-y-1 text-xs">
        {item.steps.map((step, i) => (
          <li key={i} className="flex justify-between gap-2 border-l-2 border-line pl-2">
            <span>{step.operation}</span>
            <span className="font-mono text-porcelain-dim">
              {step.durationMinutes}m · {step.requiredSkill}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="hmi-label">Priority</span>
          <select
            className="hmi-select"
            value={item.priority}
            onChange={(e) =>
              run("update_work_item", { workItemId: id, scenarioId: scenario.id, changes: { priority: Number(e.target.value) } }, "human")
            }
          >
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                P{p}{p === 1 ? " · first" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="hmi-label">Position</span>
          <select
            className="hmi-select"
            value={item.route.position ?? ""}
            disabled={item.route.resourceId === null}
            onChange={(e) => route({ position: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">by priority</option>
            {[1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                next #{p}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="hmi-label">Route to</span>
          <select
            className="hmi-select"
            value={item.route.resourceId ?? ""}
            onChange={(e) => route({ resourceId: e.target.value === "" ? null : e.target.value, position: null })}
          >
            <option value="">any eligible bay</option>
            {eligible.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

function TechnicianDetail({ scenario, simulation, id }: { scenario: Scenario; simulation: SimulationResult | null; id: string }) {
  const tech = scenario.technicians.find((t) => t.id === id);
  if (!tech) return null;
  const stat = simulation?.technicians.find((t) => t.technicianId === id);
  const jobs = simulation?.segments.filter((s) => s.technicianId === id) ?? [];
  return (
    <>
      <h2 className="font-display text-xl font-semibold uppercase tracking-wider">{tech.name}</h2>
      <p className="mb-2 text-xs text-porcelain-dim">{tech.skills.join(" · ")}</p>
      <dl>
        <Row label="Shift" value={`${formatMinute(tech.shiftStartMinute)} – ${formatMinute(tech.shiftEndMinute)}`} />
        <Row label="Cost / h" value={money(tech.costPerHour)} />
        <Row label="Utilisation" value={stat ? `${Math.round(stat.utilization * 100)}%` : "run to see"} />
        <Row label="Jobs" value={stat ? stat.jobs : "—"} />
      </dl>
      {jobs.length > 0 && (
        <ol className="mt-2 space-y-1 text-xs">
          {jobs.map((s) => {
            const item = scenario.workItems.find((w) => w.id === s.workItemId);
            return (
              <li key={`${s.workItemId}-${s.stepIndex}`} className="flex justify-between gap-2">
                <span className="truncate">{item?.vehicle} · {s.operation}</span>
                <span className="font-mono text-porcelain-dim">
                  {formatMinute(s.start)}–{formatMinute(s.end)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
