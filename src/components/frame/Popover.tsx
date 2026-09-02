"use client";

/**
 * The one ephemeral hint — and the mount point of the inspector.
 *
 * Two layers, one gesture each. **Hover or focus** gives this hint: what the
 * thing is and the single fact that matters, `pointer-events: none` so it can
 * never be hovered into staying. **Click is the commitment**: it opens the
 * `Inspector`, which is anchored, interactive, and stays until dismissed.
 *
 * Anything on the frame or on a view becomes both by spreading
 * `usePopoverAnchor(selection)` — no view stream has to know the difference.
 * The hint steps aside for whatever the inspector is already showing.
 */
import { useCallback, useEffect, useMemo, type FocusEvent, type MouseEvent, type PointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { formatMinute, type Scenario, type Selection } from "@/domain";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import type { SimulationResult } from "@/simulation";
import { floorAt, vehicleKind, workMinutes } from "@/components/derive";
import { Vehicle } from "@/components/vehicles";
import { POPOVER_ESTIMATED_HEIGHT, POPOVER_GAP, POPOVER_ID, POPOVER_WIDTH } from "./metrics";
import { Inspector, openInspector } from "./Inspector";

type Tone = "ink" | "alarm" | "warn" | "agent";

interface Fact {
  label: string;
  value: string;
  tone?: Tone;
}

interface PopoverContent {
  title: string;
  subtitle: string;
  vehicle: string | null;
  facts: Fact[];
}

const TONE_CLASS: Record<Tone, string> = {
  ink: "text-ink",
  alarm: "text-alarm",
  warn: "text-warn",
  agent: "text-agent",
};

/* ------------------------------------------------------------- the anchor */

/**
 * Props to spread on any focusable element that should explain itself.
 * The hook decides above/below here, where the anchor rectangle is known.
 */
export function usePopoverAnchor(target: Selection) {
  const { kind, id } = target;
  const setPopover = useWorkshopStore((s) => s.setPopover);
  const active = useWorkshopStore(
    (s) => s.popover !== null && s.popover.target.kind === kind && s.popover.target.id === id,
  );
  const inspected = useWorkshopStore(
    (s) => s.selection !== null && s.selection.kind === kind && s.selection.id === id,
  );

  const open = useCallback(
    (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const below = rect.bottom + POPOVER_GAP;
      const roomBelow = below + POPOVER_ESTIMATED_HEIGHT <= window.innerHeight - POPOVER_GAP;
      setPopover({
        target: { kind, id },
        x: rect.left + rect.width / 2,
        y: roomBelow
          ? below
          : Math.max(POPOVER_GAP, rect.top - POPOVER_GAP - POPOVER_ESTIMATED_HEIGHT),
      });
    },
    [setPopover, kind, id],
  );

  const close = useCallback(() => setPopover(null), [setPopover]);

  return useMemo(
    () => ({
      onPointerEnter: (event: PointerEvent<HTMLElement>) => open(event.currentTarget),
      onPointerLeave: close,
      onFocus: (event: FocusEvent<HTMLElement>) => open(event.currentTarget),
      onBlur: close,
      // Click is the commitment: it opens the inspector, and the hint gets
      // out of the way rather than sitting on top of it.
      onClick: (event: MouseEvent<HTMLElement>) => {
        openInspector({ kind, id }, event.currentTarget);
      },
      "aria-describedby": active ? POPOVER_ID : undefined,
      "aria-haspopup": "dialog" as const,
      "aria-expanded": inspected,
    }),
    [open, close, active, inspected, kind, id],
  );
}

/* ------------------------------------------------------------- the content */

function resourceContent(
  scenario: Scenario,
  simulation: SimulationResult | null,
  minute: number,
  id: string,
): PopoverContent | null {
  const resource = scenario.resources.find((r) => r.id === id);
  if (!resource) return null;
  const bay = floorAt(scenario, simulation, minute).bays[id];
  const stat = simulation?.resources.find((r) => r.resourceId === id) ?? null;
  const current = bay?.current ?? null;
  return {
    title: resource.name,
    subtitle: resource.type === "station" ? "Station" : "Bay",
    vehicle: current?.workItem.vehicle ?? null,
    facts: [
      {
        label: "Status",
        value: bay?.statusLabel ?? "Idle",
        tone: bay?.status === "blocked" || bay?.status === "down" ? "alarm" : "ink",
      },
      {
        label: "Now",
        value: current
          ? `${current.workItem.vehicle} · ${current.operation} · ends ${current.endsAt}`
          : "No job in progress",
      },
      { label: "Routed here", value: `${bay?.queued.length ?? 0} job(s) waiting` },
      {
        label: "Load",
        value: stat ? `${Math.round(stat.utilization * 100)}% of the shift` : "Not simulated",
      },
    ],
  };
}

function workItemContent(
  scenario: Scenario,
  simulation: SimulationResult | null,
  id: string,
): PopoverContent | null {
  const item = scenario.workItems.find((w) => w.id === id);
  if (!item) return null;
  const outcome = simulation?.workItems.find((w) => w.workItemId === id) ?? null;
  const routed =
    item.route.resourceId === null
      ? "Any eligible bay"
      : `${scenario.resources.find((r) => r.id === item.route.resourceId)?.name ?? item.route.resourceId}` +
        (item.route.position === null ? "" : ` · position ${item.route.position}`);
  const result = !outcome
    ? "Not simulated yet"
    : outcome.completionMinute === null
      ? "Does not finish today"
      : `Done ${formatMinute(outcome.completionMinute)}` +
        (outcome.onTime === false ? ` · ${outcome.lateMinutes} min late` : "");
  return {
    title: item.vehicle,
    subtitle: item.name,
    vehicle: item.vehicle,
    facts: [
      {
        label: "Promise",
        value: item.dueMinute === null ? "No promise" : formatMinute(item.dueMinute),
        tone: outcome?.onTime === false ? "alarm" : "ink",
      },
      { label: "Result", value: result, tone: outcome?.onTime === false ? "alarm" : "ink" },
      {
        label: "Work",
        value: `${workMinutes(item)} min · ${item.steps.length} step(s)`,
      },
      { label: "Route", value: routed },
    ],
  };
}

function technicianContent(
  scenario: Scenario,
  simulation: SimulationResult | null,
  minute: number,
  id: string,
): PopoverContent | null {
  const tech = scenario.technicians.find((t) => t.id === id);
  if (!tech) return null;
  const stat = simulation?.technicians.find((t) => t.technicianId === id) ?? null;
  const segment =
    simulation?.segments.find((s) => s.technicianId === id && s.start <= minute && s.end > minute) ?? null;
  const on = segment ? scenario.workItems.find((w) => w.id === segment.workItemId) : undefined;
  return {
    title: tech.name,
    subtitle: "Technician",
    vehicle: on?.vehicle ?? null,
    facts: [
      { label: "Skills", value: tech.skills.join(", ") },
      {
        label: "Now",
        value: segment && on ? `${on.vehicle} · ${segment.operation} · ends ${formatMinute(segment.end)}` : "Available",
      },
      { label: "Jobs today", value: stat ? `${stat.jobs}` : "Not simulated" },
      {
        label: "Load",
        value: stat ? `${Math.round(stat.utilization * 100)}% of the shift` : "Not simulated",
      },
    ],
  };
}

function contentFor(
  target: Selection,
  scenario: Scenario,
  simulation: SimulationResult | null,
  minute: number,
): PopoverContent | null {
  if (target.kind === "resource") return resourceContent(scenario, simulation, minute, target.id);
  if (target.kind === "workItem") return workItemContent(scenario, simulation, target.id);
  return technicianContent(scenario, simulation, minute, target.id);
}

/**
 * A hint is a glance, not a report: the first two facts and an invitation to
 * click. Everything else the content builders derive is the inspector's job.
 */
const HINT_FACTS = 2;

/* ------------------------------------------------------------ the popover */

export function Popover() {
  const popover = useWorkshopStore((s) => s.popover);
  const selection = useWorkshopStore((s) => s.selection);
  const setPopover = useWorkshopStore((s) => s.setPopover);
  const playbackMinute = useWorkshopStore((s) => s.playbackMinute);
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const reduced = useReducedMotion();

  const minute = playbackMinute ?? scenario.clock.startMinute;
  // The hint never covers what the inspector is already showing in full.
  const shadowed =
    popover !== null &&
    selection !== null &&
    selection.kind === popover.target.kind &&
    selection.id === popover.target.id;
  const content =
    popover && !shadowed ? contentFor(popover.target, scenario, simulation, minute) : null;

  useEffect(() => {
    if (!popover) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover, setPopover]);

  // Kept inside the pane by CSS rather than by measuring: the sheet width is
  // fixed and the anchor hook already chose the side, so a clamp() against the
  // viewport is exact horizontally and safe vertically. No layout effect, no
  // second render, nothing to go wrong during SSR.
  const left = popover
    ? `clamp(${POPOVER_GAP}px, ${popover.x - POPOVER_WIDTH / 2}px, calc(100vw - ${POPOVER_WIDTH + POPOVER_GAP}px))`
    : undefined;
  const top = popover
    ? `clamp(${POPOVER_GAP}px, ${popover.y}px, calc(100vh - ${POPOVER_ESTIMATED_HEIGHT + POPOVER_GAP}px))`
    : undefined;

  return (
    <>
      <AnimatePresence>
        {popover && content && (
          <motion.div
            key={`${popover.target.kind}:${popover.target.id}`}
            id={POPOVER_ID}
            role="tooltip"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: reduced ? 0 : 0.12, ease: "easeOut" }}
            style={{ left, top, width: POPOVER_WIDTH }}
            className="pointer-events-none fixed z-50 rounded-sheet border border-ink bg-sheet px-3 py-2 shadow-[3px_3px_0_0_var(--rule)]"
          >
            <div className="flex items-center gap-2 border-b border-rule pb-1.5">
              {content.vehicle && (
                <Vehicle kind={vehicleKind(content.vehicle)} stroke="var(--ink)" fill="var(--sheet)" width={34} />
              )}
              <div className="min-w-0">
                <p className="truncate font-mono text-[0.82rem] font-semibold text-ink">{content.title}</p>
                <p className="hmi-label truncate text-[0.6rem]">{content.subtitle}</p>
              </div>
            </div>
            <dl className="mt-1.5 space-y-1">
              {content.facts.slice(0, HINT_FACTS).map((fact) => (
                <div key={fact.label} className="flex gap-2">
                  <dt className="hmi-label w-[74px] shrink-0 pt-[1px] text-[0.58rem]">{fact.label}</dt>
                  <dd className={`min-w-0 flex-1 text-[0.72rem] leading-snug ${TONE_CLASS[fact.tone ?? "ink"]}`}>
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-1.5 border-t border-dashed border-rule pt-1 font-mono text-[0.55rem] text-ink-3">
              click for detail and actions
            </p>
            </motion.div>
        )}
      </AnimatePresence>
      <Inspector />
    </>
  );
}
