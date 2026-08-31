"use client";

/**
 * The Isometric Shop — the alternate view of the frozen composition
 * (docs/design-system.md). One full-bleed 2.5D SVG floor on the diagonal:
 * waiting lot front-left, three lifts across the back, diagnostics
 * front-right, exit strip and the parts van on the right edge.
 *
 * It is a *rendering* of the canonical world and nothing else. Every fact on
 * screen comes from the active scenario, its cached simulation and the shared
 * `derive` helpers; the component keeps no world model, runs no command and
 * owns no state beyond which hotspot has keyboard focus. Colours are the S1
 * Blueprint tokens only.
 */
import { useId, useMemo, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { formatMinute, type Resource, type Scenario, type Selection, type WorkItem } from "@/domain";
import {
  floorAt,
  promiseTone,
  vehicleKind,
  type FloorView,
} from "@/components/derive";
import type { SimulationResult } from "@/simulation";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import {
  DIAGNOSTICS,
  EXIT,
  EXIT_SLOTS,
  LIFTS,
  LIFT_LABEL_Z,
  LOT,
  LOT_GATE,
  LOT_SLOTS,
  PARTS_APRON,
  PARTS_VAN,
  PLATFORM_Z,
  PLAN_A,
  PLAN_B,
  POST_Z,
  TECH_AISLE,
  TECH_POSTS,
  createIsoFrame,
  inflate,
  liftEntry,
  zoneCentre,
  type IsoFrame,
  type IsoPoint,
  type IsoZone,
} from "./iso";
import {
  isoBodyKind,
  isoVehicle,
  type IsoBodyKind,
  type IsoFace,
  type IsoHeading,
  type IsoVehicleDrawing,
} from "./isoVehicle";

/* ------------------------------------------------------------------ tones */

/** The only palette this file knows: the S1 Blueprint tokens. */
type Tone = "ink" | "alarm" | "warn" | "agent" | "muted";

const STROKE: Record<Tone, string> = {
  ink: "var(--ink)",
  alarm: "var(--alarm)",
  warn: "var(--warn)",
  agent: "var(--agent)",
  muted: "var(--ink-3)",
};

const WASH: Record<Tone, string> = {
  ink: "var(--sheet)",
  alarm: "var(--alarm-wash)",
  warn: "var(--warn-wash)",
  agent: "var(--agent-wash)",
  muted: "var(--paper-2)",
};

/** Height of the shop's back walls, in plan units. Object heights live in `iso`. */
const WALL_Z = 0.34;

/** How long a car takes to glide along a proposed route. */
const DRIVE_SECONDS = 4.2;

/** The outbound lane: off the lifts, down the drive aisle, into the exit strip. */
const OUTBOUND = {
  from: { a: 1.6, b: 4.6 },
  via: { a: 6.6, b: 6.6 },
  to: { a: 11.0, b: 3.6 },
};

/** The two cars the agent's plan re-routes; the bay is read from the world. */
const PLAN_ROUTES: Array<{ workItemId: string; fallbackResourceId: string }> = [
  { workItemId: "veh-03", fallbackResourceId: "bay-3" },
  { workItemId: "veh-05", fallbackResourceId: "bay-2" },
];

/* ------------------------------------------------------------------ props */

export interface IsometricShopProps {
  /** Content-area size handed down by the shell; the floor fills it exactly. */
  width: number;
  height: number;
  className?: string;
}

export function IsometricShop({ width, height, className }: IsometricShopProps) {
  const scenario = useActiveScenario();
  const simulation = useActiveSimulation();
  const playbackMinute = useWorkshopStore((s) => s.playbackMinute);
  const story = useWorkshopStore((s) => s.story);
  const selection = useWorkshopStore((s) => s.selection);
  const agentAttention = useWorkshopStore((s) => s.agentAttention);
  const setPopover = useWorkshopStore((s) => s.setPopover);
  const reducedMotion = useReducedMotion() ?? false;
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, "");
  const [focused, setFocused] = useState<string | null>(null);

  const minute = playbackMinute ?? scenario.clock.startMinute;
  const floor = useMemo(
    () => floorAt(scenario, simulation, minute),
    [scenario, simulation, minute],
  );
  const frame = useMemo(() => createIsoFrame(width, height), [width, height]);

  if (width <= 0 || height <= 0) return null;

  const scene = buildScene({ scenario, simulation, floor, minute, story });

  const highlighted = new Set(
    [selection, agentAttention].filter(Boolean).map((s) => `${s!.kind}:${s!.id}`),
  );

  /** Hover, click and keyboard focus all anchor the shared popover. */
  const hotspot = (key: string, target: Selection, label: string, outline: string) => ({
    id: key,
    label,
    outline,
    focused: focused === key,
    highlighted: highlighted.has(`${target.kind}:${target.id}`),
    handlers: {
      onPointerEnter: (e: React.PointerEvent) => setPopover({ target, x: e.clientX, y: e.clientY }),
      onPointerLeave: () => setPopover(null),
      onClick: (e: React.MouseEvent) => setPopover({ target, x: e.clientX, y: e.clientY }),
      onFocus: (e: React.FocusEvent<SVGGElement>) => {
        setFocused(key);
        const box = e.currentTarget.getBoundingClientRect();
        setPopover({ target, x: box.left + box.width / 2, y: box.top });
      },
      onBlur: () => {
        setFocused((current) => (current === key ? null : current));
        setPopover(null);
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") setPopover(null);
      },
    },
  });

  type Prop = { key: string; depth: number; node: ReactNode };
  const props: Prop[] = [];
  const labels: ReactNode[] = [];

  /* ------------------------------------------------------------ the lifts */

  for (const zone of LIFTS) {
    const resource = scenario.resources.find((r) => r.id === zone.resourceId);
    if (!resource) continue;
    const view = floor.bays[resource.id];
    const held = holdsPart(resource, minute);
    const blocked = held && story !== "resolved";
    const car = view?.current?.workItem ?? (held ? nextInBay(view?.queued) : undefined);
    const centre = zoneCentre(zone);
    const spot = hotspot(
      `lift:${resource.id}`,
      { kind: "resource", id: resource.id },
      liftAria(resource, view?.statusLabel ?? "Idle", car, blocked),
      frame.quad(inflate(zone, 0.12)),
    );

    props.push({
      key: spot.id,
      depth: centre.a + centre.b,
      node: (
        <Hotspot {...spot}>
          <Lift
            frame={frame}
            zone={zone}
            blocked={blocked}
            hatchId={`iso-hatch-warn-${uid}`}
            car={car ? vehicleFor(car, simulation, blocked) : null}
          />
        </Hotspot>
      ),
    });

    labels.push(
      <LiftLabel
        key={`lift-label-${resource.id}`}
        frame={frame}
        zone={zone}
        name={resource.name}
        status={liftStatus(resource, view?.current?.endsAt ?? null, blocked, held)}
        tone={blocked ? "warn" : view?.current ? "ink" : "muted"}
      />,
    );
  }

  /* ------------------------------------------------------ the diagnostics */

  {
    const resource = scenario.resources.find((r) => r.id === DIAGNOSTICS.resourceId);
    if (resource) {
      const view = floor.bays[resource.id];
      const car = view?.current?.workItem;
      const centre = zoneCentre(DIAGNOSTICS);
      const spot = hotspot(
        `station:${resource.id}`,
        { kind: "resource", id: resource.id },
        liftAria(resource, view?.statusLabel ?? "Idle", car, false),
        frame.quad(inflate(DIAGNOSTICS, 0.12)),
      );
      props.push({
        key: spot.id,
        depth: centre.a + centre.b,
        node: (
          <Hotspot {...spot}>
            <Diagnostics
              frame={frame}
              car={car ? vehicleFor(car, simulation, false) : null}
            />
          </Hotspot>
        ),
      });
      labels.push(
        <LiftLabel
          key="station-label"
          frame={frame}
          zone={DIAGNOSTICS}
          name={resource.name}
          status={view?.current ? `ENDS ${view.current.endsAt}` : "IDLE"}
          tone={view?.current ? "ink" : "muted"}
          topZ={1.5}
          tickZ={1.0}
        />,
      );
    }
  }

  /* ------------------------------------------------------- the waiting lot */

  const placements = new Map<string, { a: number; b: number }>();
  scene.lotCars.forEach((item, index) => {
    const slot = LOT_SLOTS[index];
    placements.set(item.id, slot);
    const spot = hotspot(
      `car:${item.id}`,
      { kind: "workItem", id: item.id },
      carAria(item, simulation, "waiting in the lot"),
      "",
    );
    props.push({
      key: spot.id,
      depth: slot.a + slot.b,
      node: (
        <Hotspot {...spot}>
          <Car
            frame={frame}
            a={slot.a}
            b={slot.b}
            heading="a+"
            {...vehicleFor(item, simulation, false)}
          />
        </Hotspot>
      ),
    });
  });

  /* --------------------------------------------------------- the exit strip */

  scene.exitCars.forEach((item, index) => {
    const slot = EXIT_SLOTS[index];
    const spot = hotspot(
      `car:${item.id}`,
      { kind: "workItem", id: item.id },
      carAria(item, simulation, "ready for collection"),
      "",
    );
    props.push({
      key: spot.id,
      depth: slot.a + slot.b,
      node: (
        <Hotspot {...spot}>
          <Car
            frame={frame}
            a={slot.a}
            b={slot.b}
            heading="b-"
            {...vehicleFor(item, simulation, false)}
          />
        </Hotspot>
      ),
    });
  });

  /* ---------------------------------------------------------- the parts van */

  {
    const target = scene.partsResourceId ?? LIFTS[LIFTS.length - 1].resourceId;
    const spot = hotspot(
      `parts:${target}`,
      { kind: "resource", id: target },
      `Parts van — ${scene.partsHeadline} ${scene.partsStatus}`,
      "",
    );
    props.push({
      key: spot.id,
      depth: PARTS_VAN.a + PARTS_VAN.b,
      node: (
        <Hotspot {...spot}>
          <Car
            frame={frame}
            a={PARTS_VAN.a}
            b={PARTS_VAN.b}
            heading="b-"
            bodyKind="van"
            tone={scene.partsPending ? "warn" : "ink"}
            length={2.15}
          />
        </Hotspot>
      ),
    });
    labels.push(
      <PartsPlate
        key="parts-plate"
        frame={frame}
        headline={scene.partsHeadline}
        status={scene.partsStatus}
        tone={scene.partsPending ? "warn" : "muted"}
      />,
    );
  }

  /* -------------------------------------------------------- the technicians */

  let idleSeat = 0;
  for (const tech of scenario.technicians) {
    const busyAt = Object.values(floor.bays).find(
      (bay) => bay.current && bay.current.technicianName === tech.name,
    );
    const post = busyAt ? TECH_POSTS[busyAt.resourceId] : undefined;
    const at = post ?? TECH_AISLE[idleSeat % TECH_AISLE.length];
    if (!post) idleSeat += 1;
    const spot = hotspot(
      `tech:${tech.id}`,
      { kind: "technician", id: tech.id },
      `${tech.name} — ${busyAt ? `working ${busyAt.current?.operation}` : "available"}`,
      "",
    );
    props.push({
      key: spot.id,
      depth: at.a + at.b + 0.05,
      node: (
        <Hotspot {...spot}>
          <TechnicianBadge frame={frame} a={at.a} b={at.b} name={tech.name} busy={Boolean(busyAt)} />
        </Hotspot>
      ),
    });
  }

  props.sort((left, right) => left.depth - right.depth);

  /* ------------------------------------------------------------- the routes */

  const planRoutes = scene.showPlan
    ? PLAN_ROUTES.map(({ workItemId, fallbackResourceId }) => {
        const item = scenario.workItems.find((w) => w.id === workItemId);
        if (!item) return null;
        const resourceId = planTarget(item, simulation) ?? fallbackResourceId;
        const zone = LIFTS.find((l) => l.resourceId === resourceId);
        if (!zone) return null;
        const from = placements.get(item.id) ?? LOT_GATE;
        return {
          id: item.id,
          bodyKind: isoBodyKind(item.vehicle, vehicleKind(item.vehicle)),
          from,
          to: liftEntry(zone),
          label: `${item.vehicle} to ${resourceId.replace("bay-", "Bay ")}`,
        };
      }).filter(Boolean)
    : [];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Isometric shop floor at ${formatMinute(minute)}. ${scene.summary}`}
      style={{ display: "block", touchAction: "manipulation" }}
    >
      <defs>
        <pattern
          id={`iso-hatch-warn-${uid}`}
          patternUnits="userSpaceOnUse"
          width="7"
          height="7"
          patternTransform="rotate(35)"
        >
          <rect width="7" height="7" fill="var(--warn-wash)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--warn)" strokeWidth="1.1" opacity="0.55" />
        </pattern>
        <pattern
          id={`iso-hatch-exit-${uid}`}
          patternUnits="userSpaceOnUse"
          width="9"
          height="9"
          patternTransform="rotate(-35)"
        >
          <line x1="0" y1="0" x2="0" y2="9" stroke="var(--ink-3)" strokeWidth="1" opacity="0.35" />
        </pattern>
      </defs>

      <DrawingFrame width={width} height={height} caption={scene.caption} minute={minute} />
      <FloorPlate frame={frame} />
      <Pads frame={frame} exitHatchId={`iso-hatch-exit-${uid}`} />
      <FlowPaths frame={frame} />

      {planRoutes.map((route) =>
        route ? (
          <PlanRoute
            key={`route-${route.id}`}
            frame={frame}
            route={route}
            solid={story === "resolved"}
            reducedMotion={reducedMotion}
          />
        ) : null,
      )}

      {props.map((prop) => (
        <g key={prop.key}>{prop.node}</g>
      ))}

      {labels}
      <ZoneLabels frame={frame} waiting={scene.waitingCount} overflow={scene.lotOverflow} />
    </svg>
  );
}

/* -------------------------------------------------------------- the scene */

interface SceneInput {
  scenario: Scenario;
  simulation: SimulationResult | null;
  floor: FloorView;
  minute: number;
  story: string;
}

/**
 * Everything the drawing needs that is not geometry, derived once from the
 * canonical world. The parts van reads the bay-3 disruption straight off the
 * blocked resource — there is no second copy of the story anywhere.
 */
function buildScene({ scenario, simulation, floor, minute, story }: SceneInput) {
  const blockedResource = scenario.resources.find((r) => r.blockedUntilMinute !== null);
  const pending = blockedResource ? holdsPart(blockedResource, minute) && story !== "resolved" : false;
  const part = blockedResource?.blockingReason
    ? blockedResource.blockingReason.replace(/^waiting for an? /i, "").split("—")[0].trim()
    : null;
  const eta = blockedResource?.blockedUntilMinute ?? null;

  const onStations = new Set<string>();
  for (const zone of [...LIFTS, DIAGNOSTICS]) {
    const view = floor.bays[zone.resourceId];
    if (!view) continue;
    if (view.current) onStations.add(view.current.workItem.id);
    else if (view.status === "blocked") {
      const held = nextInBay(view.queued);
      if (held) onStations.add(held.id);
    }
  }

  const waiting = floor.waiting.filter((item) => !onStations.has(item.id));
  const promisesMet = simulation?.totals.promisesMet ?? null;
  const promisedTotal = simulation?.totals.promisedTotal ?? scenario.workItems.filter((w) => w.dueMinute !== null).length;

  return {
    lotCars: waiting.slice(0, LOT_SLOTS.length),
    lotOverflow: Math.max(0, waiting.length - LOT_SLOTS.length),
    waitingCount: waiting.length,
    exitCars: floor.completed.slice(-EXIT_SLOTS.length),
    partsPending: pending,
    partsResourceId: blockedResource?.id ?? null,
    partsHeadline: part ? `PARTS · ${part.toUpperCase()}` : "PARTS · NO ORDER OPEN",
    partsStatus: !part
      ? "VAN ON SITE"
      : pending
        ? `ETA ${formatMinute(eta ?? minute)}`
        : `ARRIVED ${formatMinute(eta ?? minute)}`,
    showPlan: story === "proposal" || story === "resolved",
    caption: scenario.name,
    summary:
      promisesMet === null
        ? `${waiting.length} cars waiting.`
        : `${promisesMet} of ${promisedTotal} promises on plan, ${waiting.length} cars waiting.`,
  };
}

/** The car standing on a blocked lift: the one pinned nearest the front of its queue. */
function nextInBay(queued: WorkItem[] | undefined): WorkItem | undefined {
  if (!queued || queued.length === 0) return undefined;
  return [...queued].sort(
    (l, r) => (l.route.position ?? Number.MAX_SAFE_INTEGER) - (r.route.position ?? Number.MAX_SAFE_INTEGER),
  )[0];
}

/** World fact: this resource is standing still with a car on it, waiting for a part. */
function holdsPart(resource: Resource, minute: number): boolean {
  return resource.blockedUntilMinute !== null && resource.blockedUntilMinute > minute;
}

function planTarget(item: WorkItem, simulation: SimulationResult | null): string | null {
  if (item.route.resourceId && LIFTS.some((l) => l.resourceId === item.route.resourceId)) {
    return item.route.resourceId;
  }
  const segment = simulation?.segments.find(
    (s) => s.workItemId === item.id && LIFTS.some((l) => l.resourceId === s.resourceId),
  );
  return segment?.resourceId ?? null;
}

/**
 * A car is red when its promise is projected to be missed and amber while the
 * lift it stands on is blocked. `blocked` comes from the resource, not from
 * `item.status`: the fixture's status never clears, the world's does.
 */
function vehicleFor(item: WorkItem, simulation: SimulationResult | null, blocked: boolean) {
  const tone: Tone =
    promiseTone(item, simulation) === "missed" ? "alarm" : blocked ? "warn" : "ink";
  return { bodyKind: isoBodyKind(item.vehicle, vehicleKind(item.vehicle)), tone };
}

function liftStatus(
  resource: Resource,
  endsAt: string | null,
  blocked: boolean,
  held: boolean,
): string {
  const eta = formatMinute(resource.blockedUntilMinute ?? 0);
  if (blocked) return `BLOCKED · ETA ${eta}`;
  if (endsAt) return `ENDS ${endsAt}`;
  // The part is still on its way, but the applied plan means it is no longer a risk.
  return held ? `PART DUE ${eta}` : "IDLE";
}

function liftAria(
  resource: Resource,
  statusLabel: string,
  car: WorkItem | undefined,
  blocked: boolean,
): string {
  const state = blocked ? `blocked until ${formatMinute(resource.blockedUntilMinute ?? 0)}` : statusLabel;
  return car ? `${resource.name}, ${state}, ${car.vehicle}` : `${resource.name}, ${state}`;
}

function carAria(item: WorkItem, simulation: SimulationResult | null, where: string): string {
  const tone = promiseTone(item, simulation);
  const promise = item.dueMinute === null ? "no promise" : `promised ${formatMinute(item.dueMinute)}`;
  const risk = tone === "missed" ? ", at risk" : tone === "kept" ? ", on time" : "";
  return `${item.vehicle}, ${item.name}, ${promise}${risk}, ${where}`;
}

/* ---------------------------------------------------------------- hotspot */

interface HotspotProps {
  id: string;
  label: string;
  outline: string;
  focused: boolean;
  highlighted: boolean;
  handlers: Record<string, unknown>;
  children: ReactNode;
}

/**
 * Every interactive component of the floor is the same thing: a focusable
 * group that anchors the shared popover on hover, click and keyboard focus.
 */
function Hotspot({ label, outline, focused, highlighted, handlers, children }: HotspotProps) {
  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={label}
      style={{ cursor: "pointer", outline: "none" }}
      {...handlers}
    >
      {children}
      {(focused || highlighted) && outline ? (
        <path
          d={outline}
          fill="none"
          stroke="var(--agent)"
          strokeWidth={focused ? 2 : 1.4}
          strokeDasharray={focused ? "5 3" : undefined}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------ floor plate */

function FloorPlate({ frame }: { frame: IsoFrame }) {
  const shop: IsoZone = { a0: 0, a1: PLAN_A, b0: 0, b1: PLAN_B };
  const lines: ReactNode[] = [];
  for (let a = 1; a < PLAN_A; a += 1) {
    const p0 = frame.project(a, 0);
    const p1 = frame.project(a, PLAN_B);
    lines.push(
      <line
        key={`ga${a}`}
        x1={p0.x}
        y1={p0.y}
        x2={p1.x}
        y2={p1.y}
        stroke={a % 5 === 0 ? "var(--rule)" : "var(--grid)"}
        strokeWidth={a % 5 === 0 ? 0.9 : 0.7}
      />,
    );
  }
  for (let b = 1; b < PLAN_B; b += 1) {
    const p0 = frame.project(0, b);
    const p1 = frame.project(PLAN_A, b);
    lines.push(
      <line
        key={`gb${b}`}
        x1={p0.x}
        y1={p0.y}
        x2={p1.x}
        y2={p1.y}
        stroke={b % 5 === 0 ? "var(--rule)" : "var(--grid)"}
        strokeWidth={b % 5 === 0 ? 0.9 : 0.7}
      />,
    );
  }
  return (
    <g>
      <path d={frame.quad(shop)} fill="var(--paper-2)" stroke="var(--rule-2)" strokeWidth={1.2} />
      {lines}
      {/* Two low back walls give the plate its 2.5D read without a 3D engine. */}
      <path
        d={frame.face(0, 0, PLAN_A, 0, 0, WALL_Z)}
        fill="var(--paper)"
        stroke="var(--rule-2)"
        strokeWidth={1}
      />
      <path
        d={frame.face(0, 0, 0, PLAN_B, 0, WALL_Z)}
        fill="var(--paper)"
        stroke="var(--rule-2)"
        strokeWidth={1}
      />
      <path d={frame.quad(shop)} fill="none" stroke="var(--ink-3)" strokeWidth={1} opacity={0.5} />
    </g>
  );
}

/* -------------------------------------------------------------------- pads */

function Pads({ frame, exitHatchId }: { frame: IsoFrame; exitHatchId: string }) {
  return (
    <g>
      <path
        d={frame.quad(LOT)}
        fill="var(--paper)"
        stroke="var(--rule-2)"
        strokeWidth={1}
        strokeDasharray="6 4"
      />
      {LOT_SLOTS.map((slot) => (
        <path
          key={`slot-${slot.a}-${slot.b}`}
          d={frame.quad({ a0: slot.a - 1.0, a1: slot.a + 1.0, b0: slot.b - 0.55, b1: slot.b + 0.55 })}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={0.9}
        />
      ))}
      <path d={frame.quad(EXIT)} fill={`url(#${exitHatchId})`} stroke="var(--rule-2)" strokeWidth={1} />
      <path
        d={frame.quad(PARTS_APRON)}
        fill="var(--paper)"
        stroke="var(--rule-2)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <path
        d={frame.quad(DIAGNOSTICS)}
        fill="var(--sheet)"
        stroke="var(--ink-3)"
        strokeWidth={1.1}
      />
    </g>
  );
}

/* ------------------------------------------------------------- flow paths */

/** How work moves: lot to each lift. Drafting dashes, never animated. */
function FlowPaths({ frame }: { frame: IsoFrame }) {
  const out = curve(frame, OUTBOUND.from, OUTBOUND.to, OUTBOUND.via);
  return (
    <g fill="none" stroke="var(--ink-3)" strokeWidth={1} opacity={0.6}>
      <path d={out.d} strokeDasharray="5 6" />
      <path d={chevron(out.tip, out.tangent, 6)} />
      {LIFTS.map((zone) => {
        const entry = liftEntry(zone);
        const { d, tip, tangent } = curve(frame, LOT_GATE, entry, { a: (LOT_GATE.a + entry.a) / 2, b: 4.5 });
        return (
          <g key={`flow-${zone.resourceId}`}>
            <path d={d} strokeDasharray="5 6" />
            <path d={chevron(tip, tangent, 6)} />
          </g>
        );
      })}
    </g>
  );
}

/** Quadratic from one plan point to another, bent through the drive aisle. */
function curve(
  frame: IsoFrame,
  from: { a: number; b: number },
  to: { a: number; b: number },
  via: { a: number; b: number },
): { d: string; points: IsoPoint[]; tip: IsoPoint; tangent: IsoPoint } {
  const p0 = frame.project(from.a, from.b);
  const p2 = frame.project(to.a, to.b);
  const control = frame.project(via.a, via.b);
  const points: IsoPoint[] = [];
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u * u * p0.x + 2 * u * t * control.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * control.y + t * t * p2.y,
    });
  }
  return {
    d: `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
    points,
    tip: p2,
    tangent: { x: p2.x - control.x, y: p2.y - control.y },
  };
}

function chevron(tip: IsoPoint, tangent: IsoPoint, size: number): string {
  const len = Math.hypot(tangent.x, tangent.y) || 1;
  const ux = tangent.x / len;
  const uy = tangent.y / len;
  const back = { x: tip.x - ux * size, y: tip.y - uy * size };
  const nx = -uy * size * 0.55;
  const ny = ux * size * 0.55;
  return `M${(back.x + nx).toFixed(1)} ${(back.y + ny).toFixed(1)} L${tip.x.toFixed(1)} ${tip.y.toFixed(1)} L${(back.x - nx).toFixed(1)} ${(back.y - ny).toFixed(1)}`;
}

/* ------------------------------------------------------------ plan routes */

interface RouteSpec {
  id: string;
  bodyKind: IsoBodyKind;
  from: { a: number; b: number };
  to: { a: number; b: number };
  label: string;
}

/**
 * The agent's proposed routing, drawn on the floor: dashed while it is only a
 * proposal, solid once it has been applied, with the car gliding along it.
 */
function PlanRoute({
  frame,
  route,
  solid,
  reducedMotion,
}: {
  frame: IsoFrame;
  route: RouteSpec;
  solid: boolean;
  reducedMotion: boolean;
}) {
  const { d, points, tip, tangent } = curve(frame, route.from, route.to, {
    a: (route.from.a + route.to.a) / 2,
    b: 4.7,
  });
  const start = points[0];
  const glyph = isoVehicle({
    frame,
    bodyKind: route.bodyKind,
    a: route.from.a,
    b: route.from.b,
    heading: "a+",
    length: 1.75,
  });
  const xs = points.map((p) => p.x - start.x);
  const ys = points.map((p) => p.y - start.y);
  const last = points.length - 1;

  return (
    <g aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="var(--agent)"
        strokeWidth={solid ? 2 : 1.8}
        strokeDasharray={solid ? undefined : "8 5"}
        opacity={0.9}
      />
      <path d={chevron(tip, tangent, 8)} fill="none" stroke="var(--agent)" strokeWidth={1.8} />
      {reducedMotion ? (
        <g transform={`translate(${xs[last].toFixed(1)} ${ys[last].toFixed(1)})`} opacity={0.85}>
          <VehicleBody drawing={glyph} tone="agent" />
        </g>
      ) : (
        /*
         * Declarative SVG motion rather than a JS tween: the floor re-renders
         * on every hover (the popover lives in the store), and a re-rendered
         * tween would restart on each one. The engine owns this one.
         */
        <g>
          <g transform={`translate(${(-start.x).toFixed(1)} ${(-start.y).toFixed(1)})`}>
            <VehicleBody drawing={glyph} tone="agent" />
          </g>
          <animateMotion dur={`${DRIVE_SECONDS}s`} repeatCount="indefinite" path={d} rotate="0" />
          <animate
            attributeName="opacity"
            values="0;0.9;0.9;0"
            keyTimes="0;0.1;0.86;1"
            dur={`${DRIVE_SECONDS}s`}
            repeatCount="indefinite"
          />
        </g>
      )}
    </g>
  );
}

/* ----------------------------------------------------------------- vehicle */

interface CarProps {
  frame: IsoFrame;
  a: number;
  b: number;
  z?: number;
  heading?: IsoHeading;
  bodyKind: IsoBodyKind;
  tone: Tone;
  length?: number;
}

function Car({ frame, a, b, z = 0, heading = "a+", bodyKind, tone, length }: CarProps) {
  const drawing = isoVehicle({ frame, bodyKind, a, b, z, heading, length });
  return <VehicleBody drawing={drawing} tone={tone} />;
}

/** Which token each projected surface takes. Light from above: roofs are palest. */
const SURFACE_FILL: Record<IsoFace["surface"], string> = {
  far: "var(--paper)",
  shoulder: "var(--paper-2)",
  glass: "var(--paper)",
  roof: "var(--sheet)",
  fascia: "var(--paper-2)",
};

/**
 * Paints the solid back to front: contact patch, far side, the surfaces that
 * span the two sides, the greenhouse, then the near side over the wheels —
 * the arch cut in the body outline is what lets the tyres show through.
 */
function VehicleBody({ drawing, tone }: { drawing: IsoVehicleDrawing; tone: Tone }) {
  const stroke = STROKE[tone];
  const fill = WASH[tone];
  const hair = { vectorEffect: "non-scaling-stroke" as const, strokeLinejoin: "round" as const };
  return (
    <g>
      <path d={drawing.shadow} fill="var(--ink-3)" opacity={0.11} />

      <g transform={drawing.farPlane} opacity={0.5}>
        <path d={drawing.body} fill="var(--paper)" stroke={stroke} strokeWidth={1.1} {...hair} />
      </g>
      <g transform={drawing.cabinFarPlane} opacity={0.5}>
        <path d={drawing.cabin} fill="var(--paper)" stroke={stroke} strokeWidth={1.1} {...hair} />
      </g>

      {drawing.faces.map((face, index) => (
        <path
          key={`${face.surface}-${index}`}
          d={face.d}
          fill={SURFACE_FILL[face.surface]}
          stroke={stroke}
          strokeWidth={1.2}
          {...hair}
        />
      ))}

      <g transform={drawing.cabinNearPlane}>
        <path d={drawing.cabin} fill="var(--paper-2)" stroke={stroke} strokeWidth={1.4} {...hair} />
        <path d={drawing.glass} fill="var(--paper)" stroke={stroke} strokeWidth={1} opacity={0.8} {...hair} />
      </g>

      <g transform={drawing.nearPlane}>
        {drawing.wheels.map((wheel) => (
          <g key={wheel.cx}>
            <circle
              cx={wheel.cx}
              cy={wheel.cy}
              r={wheel.r}
              fill="var(--paper)"
              stroke={stroke}
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={wheel.cx}
              cy={wheel.cy}
              r={wheel.r * 0.42}
              fill="var(--sheet)"
              stroke={stroke}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        <path d={drawing.body} fill={fill} stroke={stroke} strokeWidth={1.6} {...hair} />
        <path d={drawing.beltline} fill="none" stroke={stroke} strokeWidth={1} opacity={0.55} {...hair} />
        <path d={drawing.doorLine} fill="none" stroke={stroke} strokeWidth={0.9} opacity={0.45} {...hair} />
        <path d={drawing.lamps} fill="var(--sheet)" stroke={stroke} strokeWidth={0.9} {...hair} />
      </g>
    </g>
  );
}

/* -------------------------------------------------------------------- lift */

function Lift({
  frame,
  zone,
  blocked,
  hatchId,
  car,
}: {
  frame: IsoFrame;
  zone: IsoZone;
  blocked: boolean;
  hatchId: string;
  car: { bodyKind: IsoBodyKind; tone: Tone } | null;
}) {
  const centre = zoneCentre(zone);
  const stroke = blocked ? "var(--warn)" : "var(--ink)";
  const platform: IsoZone = {
    a0: zone.a0 + 0.2,
    a1: zone.a1 - 0.2,
    b0: zone.b0 + 0.45,
    b1: zone.b1 - 0.45,
  };
  const postA = zone.a0 + 0.3;
  const postB = zone.a1 - 0.3;
  return (
    <g>
      <path
        d={frame.quad(zone)}
        fill={blocked ? `url(#${hatchId})` : "var(--sheet)"}
        stroke={stroke}
        strokeWidth={blocked ? 1.6 : 1.2}
      />
      <Post frame={frame} a={postA} b={zone.b0 + 0.42} stroke={stroke} />
      <Post frame={frame} a={postB} b={zone.b0 + 0.42} stroke={stroke} />
      <path
        d={frame.face(platform.a0, platform.b1, platform.a1, platform.b1, PLATFORM_Z - 0.07, PLATFORM_Z)}
        fill="var(--paper)"
        stroke={stroke}
        strokeWidth={1}
      />
      <path
        d={frame.face(platform.a1, platform.b0, platform.a1, platform.b1, PLATFORM_Z - 0.07, PLATFORM_Z)}
        fill="var(--paper)"
        stroke={stroke}
        strokeWidth={1}
      />
      <path d={frame.quad(platform, PLATFORM_Z)} fill="var(--sheet)" stroke={stroke} strokeWidth={1.2} />
      {car ? (
        <Car
          frame={frame}
          a={centre.a}
          b={centre.b}
          z={PLATFORM_Z}
          heading="a+"
          bodyKind={car.bodyKind}
          tone={car.tone}
        />
      ) : null}
    </g>
  );
}

function Post({ frame, a, b, stroke }: { frame: IsoFrame; a: number; b: number; stroke: string }) {
  const s = 0.14;
  const zone: IsoZone = { a0: a - s, a1: a + s, b0: b - s, b1: b + s };
  const top = POST_Z;
  return (
    <g>
      <path d={frame.face(zone.a0, zone.b1, zone.a1, zone.b1, 0, top)} fill="var(--paper)" stroke={stroke} strokeWidth={1} />
      <path d={frame.face(zone.a1, zone.b0, zone.a1, zone.b1, 0, top)} fill="var(--paper-2)" stroke={stroke} strokeWidth={1} />
      <path d={frame.quad(zone, top)} fill="var(--sheet)" stroke={stroke} strokeWidth={1} />
    </g>
  );
}

/* ------------------------------------------------------------ diagnostics */

function Diagnostics({ frame, car }: { frame: IsoFrame; car: { bodyKind: IsoBodyKind; tone: Tone } | null }) {
  const booth: IsoZone = { a0: DIAGNOSTICS.a1 - 0.95, a1: DIAGNOSTICS.a1 - 0.1, b0: DIAGNOSTICS.b0 + 0.2, b1: DIAGNOSTICS.b1 - 0.2 };
  const boothZ = 0.95;
  return (
    <g>
      <path d={frame.face(booth.a0, booth.b1, booth.a1, booth.b1, 0, boothZ)} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.1} />
      <path d={frame.face(booth.a1, booth.b0, booth.a1, booth.b1, 0, boothZ)} fill="var(--paper-2)" stroke="var(--ink)" strokeWidth={1.1} />
      <path d={frame.quad(booth, boothZ)} fill="var(--sheet)" stroke="var(--ink)" strokeWidth={1.1} />
      {car ? (
        <Car frame={frame} a={DIAGNOSTICS.a0 + 1.0} b={(DIAGNOSTICS.b0 + DIAGNOSTICS.b1) / 2} heading="a+" bodyKind={car.bodyKind} tone={car.tone} />
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------ technicians */

function TechnicianBadge({
  frame,
  a,
  b,
  name,
  busy,
}: {
  frame: IsoFrame;
  a: number;
  b: number;
  name: string;
  busy: boolean;
}) {
  const foot = frame.project(a, b);
  const head = frame.project(a, b, 0.62);
  const r = Math.max(8, frame.halfH * 0.36);
  const stroke = busy ? "var(--ink)" : "var(--ink-3)";
  return (
    <g>
      <path
        d={`M${(foot.x - r * 0.5).toFixed(1)} ${foot.y.toFixed(1)} L${foot.x.toFixed(1)} ${(foot.y - r * 0.26).toFixed(1)} L${(foot.x + r * 0.5).toFixed(1)} ${foot.y.toFixed(1)} L${foot.x.toFixed(1)} ${(foot.y + r * 0.26).toFixed(1)} Z`}
        fill="none"
        stroke="var(--rule-2)"
        strokeWidth={0.9}
      />
      <line x1={foot.x} y1={foot.y} x2={head.x} y2={head.y + r * 0.7} stroke={stroke} strokeWidth={1.1} />
      <circle cx={head.x} cy={head.y} r={r} fill="var(--sheet)" stroke={stroke} strokeWidth={1.4} />
      <text
        x={head.x}
        y={head.y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={stroke}
        style={{ fontFamily: "var(--font-mono)", fontSize: r * 1.05, fontWeight: 600, letterSpacing: "0.02em" }}
      >
        {name.slice(0, 1).toUpperCase()}
      </text>
    </g>
  );
}

/* ----------------------------------------------------------------- labels */

function IsoText({
  x,
  y,
  tone = "muted",
  size = 9.5,
  anchor = "middle",
  children,
}: {
  x: number;
  y: number;
  tone?: Tone;
  size?: number;
  anchor?: "start" | "middle" | "end";
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={STROKE[tone]}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "0.12em",
      }}
    >
      {children.toUpperCase()}
    </text>
  );
}

function LiftLabel({
  frame,
  zone,
  name,
  status,
  tone,
  topZ = LIFT_LABEL_Z,
  tickZ = PLATFORM_Z + 0.15,
}: {
  frame: IsoFrame;
  zone: IsoZone;
  name: string;
  status: string;
  tone: Tone;
  topZ?: number;
  tickZ?: number;
}) {
  const centre = zoneCentre(zone);
  const anchor = frame.project(centre.a, zone.b0 - 0.15, topZ);
  const tick = frame.project(centre.a, zone.b0 - 0.15, tickZ);
  return (
    <g pointerEvents="none">
      <line x1={anchor.x} y1={anchor.y + 4} x2={tick.x} y2={tick.y} stroke="var(--rule-2)" strokeWidth={0.9} />
      <circle cx={tick.x} cy={tick.y} r={1.8} fill="var(--rule-2)" />
      <IsoText x={anchor.x} y={anchor.y - 11} tone="ink" size={11}>
        {name}
      </IsoText>
      <IsoText x={anchor.x} y={anchor.y} tone={tone} size={8.5}>
        {status}
      </IsoText>
    </g>
  );
}

function PartsPlate({
  frame,
  headline,
  status,
  tone,
}: {
  frame: IsoFrame;
  headline: string;
  status: string;
  tone: Tone;
}) {
  const anchor = frame.project(PARTS_VAN.a, PARTS_VAN.b, 2.15);
  const tick = frame.project(PARTS_VAN.a, PARTS_VAN.b, 1.42);
  return (
    <g pointerEvents="none">
      <line x1={anchor.x} y1={anchor.y + 4} x2={tick.x} y2={tick.y} stroke="var(--rule-2)" strokeWidth={0.9} />
      <IsoText x={anchor.x} y={anchor.y - 10} tone="ink" size={9.5}>
        {headline}
      </IsoText>
      <IsoText x={anchor.x} y={anchor.y} tone={tone} size={9.5}>
        {status}
      </IsoText>
    </g>
  );
}

function ZoneLabels({
  frame,
  waiting,
  overflow,
}: {
  frame: IsoFrame;
  waiting: number;
  overflow: number;
}) {
  const lot = frame.project((LOT.a0 + LOT.a1) / 2 + 0.9, LOT.b1 + 0.5);
  const lotTick = frame.project((LOT.a0 + LOT.a1) / 2 + 0.9, LOT.b1 - 0.15);
  const exit = frame.project((EXIT.a0 + EXIT.a1) / 2, EXIT.b0 - 0.4);
  const exitTick = frame.project((EXIT.a0 + EXIT.a1) / 2, EXIT.b0);
  return (
    <g pointerEvents="none">
      <line x1={lot.x} y1={lot.y + 4} x2={lotTick.x} y2={lotTick.y} stroke="var(--rule-2)" strokeWidth={0.9} />
      <IsoText x={lot.x} y={lot.y + 15} anchor="middle" tone="muted">
        {`Waiting lot · ${waiting}${overflow > 0 ? ` (+${overflow})` : ""}`}
      </IsoText>
      <line x1={exit.x} y1={exit.y + 4} x2={exitTick.x} y2={exitTick.y} stroke="var(--rule-2)" strokeWidth={0.9} />
      <IsoText x={exit.x} y={exit.y} anchor="middle" tone="muted">
        Exit
      </IsoText>
    </g>
  );
}

/** Registration marks and a one-line title block: this is a drawing, not a dashboard. */
function DrawingFrame({
  width,
  height,
  caption,
  minute,
}: {
  width: number;
  height: number;
  caption: string;
  minute: number;
}) {
  const inset = 6;
  const w = width - inset * 2;
  const h = height - inset * 2;
  const tick = 10;
  return (
    <g pointerEvents="none">
      <rect x={inset} y={inset} width={w} height={h} fill="none" stroke="var(--rule)" strokeWidth={1} />
      {[
        [inset + w / 2, inset, 0, tick],
        [inset + w / 2, inset + h, 0, -tick],
        [inset, inset + h / 2, tick, 0],
        [inset + w, inset + h / 2, -tick, 0],
      ].map(([x, y, dx, dy]) => (
        <line key={`${x}-${y}`} x1={x} y1={y} x2={x + dx} y2={y + dy} stroke="var(--rule-2)" strokeWidth={1} />
      ))}
      <IsoText x={inset + 10} y={inset + 16} anchor="start" tone="muted" size={9}>
        {`Isometric shop · ${caption}`}
      </IsoText>
      <IsoText x={inset + w - 10} y={inset + 16} anchor="end" tone="muted" size={9}>
        {`Floor plan · ${formatMinute(minute)}`}
      </IsoText>
    </g>
  );
}
