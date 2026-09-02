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
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import {
  formatMinute,
  type Resource,
  type Scenario,
  type Selection,
  type Technician,
  type WorkItem,
} from "@/domain";
import {
  floorAt,
  promiseTone,
  segmentsAt,
  vehicleKind,
  type FloorView,
} from "@/components/derive";
import type { Segment, SimulationResult } from "@/simulation";
import { useActiveScenario, useActiveSimulation, useWorkshopStore } from "@/store";
import { usePopoverAnchor } from "@/components/frame";
import { readWorkItemDrag } from "@/components/story/dragDrop";
import { eligibleResourceIds } from "@/components/story/planCards";
import { routeFromDrop } from "@/store/storySlice";
import { planFromCandidate } from "@/simulation";
import {
  DIAGNOSTICS,
  EXIT,
  EXIT_SLOTS,
  LIFTS,
  LIFT_LABEL_Z,
  LOT,
  LOT_GATE,
  DIAG_QUEUE,
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
  zoneContains,
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

/* Route artwork derives from the canonical plan on screen (finding 5): the
 * draft during beats 4–5, else the measured winner — never a hardcoded list. */

/**
 * A car being dragged from the lot to a lift, while the gesture is in flight.
 *
 * The gesture is driven by pointer events, not HTML5 drag-and-drop: Chrome
 * does not start a native drag from an SVG element (a `draggable` <g> fires no
 * `dragstart`, while an HTML `draggable` div beside it does). The lifts still
 * accept a native drop, so a proposal card dragged from the story panel lands
 * exactly as before; a car picked up off the floor takes the pointer path.
 * Both finish in the same place — `routeFromDrop` — which is the invariant
 * that matters: no drop reaches `route_work_item` on its own.
 */
interface FloorDrag {
  workItemId: string;
  /** Where it started, in plan units — the tail of the live route line. */
  from: { a: number; b: number };
  /** Lifts that can run this job's steps (`eligibleResourceIds`, not forked). */
  eligible: string[];
  /** Pointer in SVG coordinates; null until the gesture has moved. */
  point: IsoPoint | null;
  /** Eligible resource currently under the pointer, if any. */
  over: string | null;
}

/** Bookkeeping that must not cause a render on every pointer sample. */
interface DragGesture {
  workItemId: string;
  from: { a: number; b: number };
  eligible: string[];
  pointerId: number;
  startX: number;
  startY: number;
  /** Set once the pointer has travelled far enough to mean "drag", not "click". */
  active: boolean;
  over: string | null;
}

/** Below this the pointer has not really moved; skip the re-render. */
const DRAG_EPSILON = 3;

/** How far the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

/** How a lift reads while a car is in flight. */
type DropState = "none" | "eligible" | "over" | "ineligible";

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
  const draft = useWorkshopStore((s) => s.draft);
  const exploration = useWorkshopStore((s) => s.exploration);
  const selection = useWorkshopStore((s) => s.selection);
  const agentAttention = useWorkshopStore((s) => s.agentAttention);
  const setPopover = useWorkshopStore((s) => s.setPopover);
  const reducedMotion = useReducedMotion() ?? false;
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, "");
  const [focused, setFocused] = useState<string | null>(null);
  const [drag, setDrag] = useState<FloorDrag | null>(null);
  const gesture = useRef<DragGesture | null>(null);
  /** A drag ends in a click event the popover should not answer. */
  const swallowClick = useRef(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const minute = playbackMinute ?? scenario.clock.startMinute;
  const floor = useMemo(
    () => floorAt(scenario, simulation, minute),
    [scenario, simulation, minute],
  );
  const frame = useMemo(() => createIsoFrame(width, height), [width, height]);
  /* The one "now": live segments at `playbackMinute`, straight off the last
   * simulation's timeline. Progress bars and countdowns read only from here. */
  const liveSegments = useMemo(() => segmentsAt(simulation, minute), [simulation, minute]);

  if (width <= 0 || height <= 0) return null;

  const scene = buildScene({ scenario, simulation, floor, minute, story });
  const segmentFor = (resourceId: string): Segment | undefined =>
    liveSegments.find((s) => s.resourceId === resourceId);

  /** Where a lift stands while a car is in flight over the floor. */
  const dropStateFor = (resourceId: string): DropState => {
    if (!drag) return "none";
    if (!drag.eligible.includes(resourceId)) return "ineligible";
    return drag.over === resourceId ? "over" : "eligible";
  };

  const endDrag = () => {
    gesture.current = null;
    setDrag(null);
  };

  /**
   * Which station the pointer is standing on. What the eye aims at is the
   * drawn lift — posts, deck and all — so ask the document first. Falling back
   * to the plan geometry catches the apron around a pad, where there is
   * nothing drawn to hit but the drop still clearly means that bay.
   */
  const stationUnder = (client: IsoPoint, point: IsoPoint): string | null => {
    const element = document.elementFromPoint(client.x, client.y);
    const station = element?.closest?.("[data-station]")?.getAttribute("data-station");
    if (station) return station;
    for (const height of [PLATFORM_Z, 0]) {
      const plan = frame.unproject(point.x, point.y, height);
      const zone = [...LIFTS, DIAGNOSTICS].find((candidate) =>
        zoneContains(inflate(candidate, 0.3), plan),
      );
      if (zone) return zone.resourceId;
    }
    return null;
  };

  /** Pointer handlers that turn a car in the lot into a routing decision. */
  const carDragHandlers = (item: WorkItem, slot: { a: number; b: number }) => ({
    onPointerDown: (e: React.PointerEvent<SVGGElement>) => {
      if (e.button !== 0) return;
      // Capture keeps the gesture on this car even when the pointer crosses
      // another one. It throws if the pointer is already gone; the drag is
      // still perfectly usable without it.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* no capture available — fall back to plain pointer tracking */
      }
      gesture.current = {
        workItemId: item.id,
        from: slot,
        eligible: eligibleResourceIds(scenario, item.id),
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
        over: null,
      };
    },
    onPointerMove: (e: React.PointerEvent<SVGGElement>) => {
      const current = gesture.current;
      if (!current || current.pointerId !== e.pointerId) return;
      const box = svgRef.current?.getBoundingClientRect();
      if (!box) return;
      const point = { x: e.clientX - box.left, y: e.clientY - box.top };
      if (!current.active) {
        if (Math.hypot(e.clientX - current.startX, e.clientY - current.startY) < DRAG_THRESHOLD) {
          return;
        }
        current.active = true;
        setPopover(null);
      }
      const target = stationUnder({ x: e.clientX, y: e.clientY }, point);
      current.over = target && current.eligible.includes(target) ? target : null;
      const over = current.over;
      setDrag((previous) => {
        if (
          previous &&
          previous.over === over &&
          previous.point &&
          Math.abs(previous.point.x - point.x) < DRAG_EPSILON &&
          Math.abs(previous.point.y - point.y) < DRAG_EPSILON
        ) {
          return previous;
        }
        return {
          workItemId: current.workItemId,
          from: current.from,
          eligible: current.eligible,
          point,
          over,
        };
      });
    },
    onPointerUp: (e: React.PointerEvent<SVGGElement>) => {
      const current = gesture.current;
      gesture.current = null;
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        /* the capture was never taken */
      }
      setDrag(null);
      if (!current?.active) return;
      swallowClick.current = true;
      // The one entry point: a draft edit in beat 4, a human command otherwise.
      if (current.over) routeFromDrop(current.workItemId, current.over, 1);
    },
    onPointerCancel: endDrag,
  });

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
      // Lifts and the station accept a dragged plan card / vehicle: the shared
      // drag contract routes through the one entry point (draft in beat 4,
      // world command otherwise). A drop is refused where the job's steps
      // cannot run — `eligibleResourceIds` decides, here and in the artwork.
      ...(target.kind === "resource"
        ? {
            "data-station": target.id,
            onDragEnter: () =>
              setDrag((current) =>
                current && current.over !== target.id ? { ...current, over: target.id } : current,
              ),
            onDragOver: (e: React.DragEvent) => {
              if (drag && !drag.eligible.includes(target.id)) return;
              e.preventDefault();
            },
            onDragLeave: () =>
              setDrag((current) =>
                current && current.over === target.id ? { ...current, over: null } : current,
              ),
            onDrop: (e: React.DragEvent) => {
              const payload = readWorkItemDrag(e.dataTransfer);
              if (!payload) return;
              e.preventDefault();
              e.stopPropagation();
              setDrag(null);
              if (!eligibleResourceIds(scenario, payload.workItemId).includes(target.id)) return;
              routeFromDrop(payload.workItemId, target.id, 1);
            },
          }
        : {}),
      onPointerEnter: (e: React.PointerEvent) => {
        if (gesture.current) return;
        setPopover({ target, x: e.clientX, y: e.clientY });
      },
      onPointerLeave: () => {
        if (gesture.current) return;
        setPopover(null);
      },
      onClick: (e: React.MouseEvent) => {
        // A drag ends in a click; it is not a request for the popover.
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        setPopover({ target, x: e.clientX, y: e.clientY });
      },
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

    const dropState = dropStateFor(resource.id);

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
            dropState={dropState}
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
        status={
          dropState === "eligible" || dropState === "over"
            ? "OPEN · DROP TO ROUTE"
            : liftStatus(resource, view?.current?.endsAt ?? null, blocked, held, view?.queued.length ?? 0)
        }
        tone={
          dropState === "eligible" || dropState === "over"
            ? "agent"
            : blocked
              ? "warn"
              : view?.current
                ? "ink"
                : "muted"
        }
        bar={liftBar({
          segment: segmentFor(resource.id),
          minute,
          blocked,
          etaMinute: resource.blockedUntilMinute,
          shiftStart: scenario.clock.startMinute,
        })}
        barWidth={labelBarWidth(frame)}
        alarmHatchId={`iso-hatch-alarm-${uid}`}
        dimmed={dropState === "ineligible"}
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
      const dropState = dropStateFor(resource.id);
      props.push({
        key: spot.id,
        depth: centre.a + centre.b,
        node: (
          <Hotspot {...spot}>
            <Diagnostics
              frame={frame}
              car={car ? vehicleFor(car, simulation, false) : null}
              dropState={dropState}
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
          status={
            dropState === "eligible" || dropState === "over"
              ? "OPEN · DROP TO ROUTE"
              : liftStatus(resource, view?.current?.endsAt ?? null, false, false, view?.queued.length ?? 0)
          }
          tone={
            dropState === "eligible" || dropState === "over"
              ? "agent"
              : view?.current
                ? "ink"
                : "muted"
          }
          bar={liftBar({
            segment: segmentFor(resource.id),
            minute,
            blocked: false,
            etaMinute: null,
            shiftStart: scenario.clock.startMinute,
          })}
          barWidth={labelBarWidth(frame)}
          alarmHatchId={`iso-hatch-alarm-${uid}`}
          dimmed={dropState === "ineligible"}
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
    const dragging = drag?.workItemId === item.id;
    props.push({
      key: spot.id,
      depth: slot.a + slot.b,
      node: (
        <Hotspot
          {...spot}
          /* A car in the lot is the human's handle on the schedule: pick it up
           * and put it on a lift. */
          draggable
          handlers={{
            ...spot.handlers,
            ...carDragHandlers(item, slot),
          }}
        >
          <Car
            frame={frame}
            a={slot.a}
            b={slot.b}
            heading="a+"
            {...vehicleFor(item, simulation, false)}
            tone={dragging ? "agent" : vehicleFor(item, simulation, false).tone}
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
    const key = `tech:${tech.id}`;
    props.push({
      key,
      depth: at.a + at.b + 0.05,
      node: (
        <FloorTechnician
          frame={frame}
          a={at.a}
          b={at.b}
          technician={tech}
          busy={Boolean(busyAt)}
          label={`${tech.name} — ${busyAt ? `working ${busyAt.current?.operation}` : "available"}`}
          focused={focused === key}
          onFocusChange={(next) =>
            setFocused((current) => (next ? key : current === key ? null : current))
          }
        />
      ),
    });
  }

  props.sort((left, right) => left.depth - right.depth);

  /* ------------------------------------------------------------- the routes */

  const shownPlan =
    draft ?? (exploration.best ? planFromCandidate(exploration.best) : null);
  const planRoutes = scene.showPlan && shownPlan
    ? shownPlan.changes
        .filter((c) => c.command === "route_work_item")
        .map((change) => {
          const item = scenario.workItems.find((w) => w.id === change.workItemId);
          if (!item) return null;
          const bodyKind = isoBodyKind(item.vehicle, vehicleKind(item.vehicle));
          if (change.resourceId !== null) {
            // A pin: the car drives to the named lift.
            const zone = LIFTS.find((l) => l.resourceId === change.resourceId);
            if (!zone) return null;
            const from = placements.get(item.id) ?? LOT_GATE;
            return {
              id: item.id,
              bodyKind,
              from,
              to: liftEntry(zone),
              label: `${item.vehicle} to ${change.resourceId.replace("bay-", "Bay ")}`,
            };
          }
          // A release: only meaningful as artwork when the car is standing on a
          // lift — it rolls off along the outbound lane.
          const standing = LIFTS.find((zone) => {
            const view = floor.bays[zone.resourceId];
            const car = view?.current?.workItem ?? nextInBay(view?.queued);
            return car?.id === item.id;
          });
          if (!standing) return null;
          return {
            id: item.id,
            bodyKind,
            from: liftEntry(standing),
            to: OUTBOUND.to,
            label: `${item.vehicle} rolls off ${standing.resourceId.replace("bay-", "Bay ")}`,
          };
        })
        .filter(Boolean)
    : [];

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Isometric shop floor at ${formatMinute(minute)}. ${scene.summary}`}
      style={{ display: "block", touchAction: "manipulation" }}
      /* A proposal card dragged in from the story panel is a native HTML drag;
       * allowing it here lets it reach a lift's drop handler. */
      onDragOver={(e) => e.preventDefault()}
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
        {/* The countdown to a missing part: time running out reads alarm. */}
        <pattern
          id={`iso-hatch-alarm-${uid}`}
          patternUnits="userSpaceOnUse"
          width="5"
          height="5"
          patternTransform="rotate(45)"
        >
          <rect width="5" height="5" fill="var(--alarm-wash)" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--alarm)" strokeWidth="2" />
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

      {drag ? <DragRoute frame={frame} drag={drag} /> : null}

      {labels}
      <ZoneLabels
        frame={frame}
        waiting={scene.waitingCount}
        overflow={scene.lotOverflow}
        leaving={scene.exitCars.length}
      />
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
  queued: number,
): string {
  const eta = formatMinute(resource.blockedUntilMinute ?? 0);
  // A live counter, not a decoration: how many jobs are pinned behind this one.
  const queue = queued > 1 ? ` · Q${queued - 1}` : "";
  // While blocked the countdown underneath carries the urgency; the status row
  // stays short so it does not run over the lift it belongs to.
  if (blocked) return `BLOCKED · ETA ${eta}`;
  if (endsAt) return `ENDS ${endsAt}${queue}`;
  // The part is still on its way, but the applied plan means it is no longer a risk.
  if (held) return `PART DUE ${eta}${queue}`;
  return queued > 0 ? `IDLE · Q${queued}` : "IDLE";
}

/* ----------------------------------------------------- time made visible */

/** The bar under a lift's name plate. */
export interface LiftBarView {
  /** 0..1 — elapsed share of the job, or of the wait for the part. */
  fraction: number;
  caption: string;
  tone: Tone;
  /** Waiting for a part is hatched, not filled: nothing is being made. */
  hatched: boolean;
}

/**
 * Everything the bar shows comes from `playbackMinute` against the last
 * simulation's timeline. A blocked lift counts down to the part instead: the
 * same shape, but it measures a wait rather than work.
 */
function liftBar(args: {
  segment: Segment | undefined;
  minute: number;
  blocked: boolean;
  etaMinute: number | null;
  shiftStart: number;
}): LiftBarView | null {
  const { segment, minute, blocked, etaMinute, shiftStart } = args;
  if (blocked && etaMinute !== null) {
    const total = Math.max(1, etaMinute - shiftStart);
    const left = Math.max(0, etaMinute - minute);
    return {
      fraction: clamp01((minute - shiftStart) / total),
      caption: `${left} min to part`,
      tone: "alarm",
      hatched: true,
    };
  }
  if (!segment) return null;
  const total = Math.max(1, segment.end - segment.start);
  const elapsed = Math.max(0, Math.min(total, minute - segment.start));
  const left = total - elapsed;
  return {
    fraction: clamp01(elapsed / total),
    caption:
      left <= 5
        ? `${shorten(segment.operation)} · ${left} min left`
        : `${shorten(segment.operation)} · ${elapsed}/${total} min`,
    tone: "ink",
    hatched: false,
  };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Operation names are prose; the name plate has room for a label. */
function shorten(operation: string, max = 17): string {
  return operation.length <= max ? operation : `${operation.slice(0, max - 1).trimEnd()}…`;
}

/** The bar tracks the drawing's scale so it stays legible at both panes. */
function labelBarWidth(frame: IsoFrame): number {
  return Math.round(Math.max(74, Math.min(126, frame.halfW * 2.1)));
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
  /** Lot cars are pickable; everything else is only a target. */
  draggable?: boolean;
  children: ReactNode;
}

/**
 * Every interactive component of the floor is the same thing: a focusable
 * group that anchors the shared popover on hover, click and keyboard focus.
 */
function Hotspot({
  label,
  outline,
  focused,
  highlighted,
  handlers,
  draggable,
  children,
}: HotspotProps) {
  return (
    <g
      tabIndex={0}
      role="button"
      aria-label={label}
      style={{
        cursor: draggable ? "grab" : "pointer",
        outline: "none",
        // Finding 5 (I1): every hotspot shows keyboard focus. Shapes without a
        // zone outline (cars, technicians, the parts van) glow instead — a
        // geometry-free indicator that works on any SVG body.
        filter: focused
          ? "drop-shadow(0 0 2px var(--agent)) drop-shadow(0 0 5px var(--agent))"
          : undefined,
      }}
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
      <path
        d={frame.quad(DIAG_QUEUE)}
        fill="var(--paper)"
        stroke="var(--rule)"
        strokeWidth={0.9}
        strokeDasharray="4 4"
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
  dropState = "none",
}: {
  frame: IsoFrame;
  zone: IsoZone;
  blocked: boolean;
  hatchId: string;
  car: { bodyKind: IsoBodyKind; tone: Tone } | null;
  dropState?: DropState;
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
    <g opacity={dropState === "ineligible" ? 0.32 : 1}>
      <path
        d={frame.quad(zone)}
        fill={blocked ? `url(#${hatchId})` : "var(--sheet)"}
        stroke={stroke}
        strokeWidth={blocked ? 1.6 : 1.2}
      />
      <DropTarget frame={frame} zone={zone} state={dropState} />
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

/**
 * Where a dragged car may land. Eligible pads outline dashed agent-blue and
 * fill when the pointer is over them; ineligible ones simply dim (the parent
 * sets the opacity), so the answer is legible without reading a word.
 */
function DropTarget({
  frame,
  zone,
  state,
}: {
  frame: IsoFrame;
  zone: IsoZone;
  state: DropState;
}) {
  if (state !== "eligible" && state !== "over") return null;
  return (
    <path
      d={frame.quad(inflate(zone, 0.1))}
      fill={state === "over" ? "var(--agent-wash)" : "none"}
      stroke="var(--agent)"
      strokeWidth={state === "over" ? 2.4 : 1.6}
      strokeDasharray="7 5"
      pointerEvents="none"
    />
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

function Diagnostics({
  frame,
  car,
  dropState = "none",
}: {
  frame: IsoFrame;
  car: { bodyKind: IsoBodyKind; tone: Tone } | null;
  dropState?: DropState;
}) {
  // A compact console on the near-b corner of the pad. The car parks on the
  // far-b side, so the two projections stay fully disjoint on screen: the
  // car's largest a-b reach (11.25 - 9.14) never crosses the booth's smallest
  // (10.9 - 8.5).
  const booth: IsoZone = { a0: DIAGNOSTICS.a1 - 1.5, a1: DIAGNOSTICS.a1 - 0.15, b0: DIAGNOSTICS.b0 + 0.2, b1: DIAGNOSTICS.b0 + 1.2 };
  const boothZ = 0.95;
  return (
    <g opacity={dropState === "ineligible" ? 0.32 : 1}>
      <DropTarget frame={frame} zone={DIAGNOSTICS} state={dropState} />
      {car ? (
        <Car frame={frame} a={DIAGNOSTICS.a0 + 0.9} b={DIAGNOSTICS.b1 - 1.05} heading="a+" bodyKind={car.bodyKind} tone={car.tone} length={1.7} />
      ) : null}
      <path d={frame.face(booth.a0, booth.b1, booth.a1, booth.b1, 0, boothZ)} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.1} />
      <path d={frame.face(booth.a1, booth.b0, booth.a1, booth.b1, 0, boothZ)} fill="var(--paper-2)" stroke="var(--ink)" strokeWidth={1.1} />
      <path d={frame.quad(booth, boothZ)} fill="var(--sheet)" stroke="var(--ink)" strokeWidth={1.1} />
    </g>
  );
}

/* ------------------------------------------------------------ technicians */

/**
 * A technician on the floor. The anchor comes from `usePopoverAnchor`, the
 * same hook the Board's blocks use, so a click here opens the shared
 * technician inspector rather than a second, floor-only popover.
 */
function FloorTechnician({
  frame,
  a,
  b,
  technician,
  busy,
  label,
  focused,
  onFocusChange,
}: {
  frame: IsoFrame;
  a: number;
  b: number;
  technician: Technician;
  busy: boolean;
  label: string;
  focused: boolean;
  onFocusChange: (focused: boolean) => void;
}) {
  const anchor = usePopoverAnchor({ kind: "technician", id: technician.id });
  const { onFocus, onBlur, ...rest } = anchor;
  return (
    <Hotspot
      id={`tech:${technician.id}`}
      label={label}
      outline=""
      focused={focused}
      highlighted={false}
      handlers={{
        ...rest,
        // The hook types its handlers for HTML; the anchor rectangle it reads
        // is on `Element`, so an SVG group answers it just as well.
        onFocus: (event: React.FocusEvent<SVGGElement>) => {
          onFocusChange(true);
          onFocus(event as unknown as React.FocusEvent<HTMLElement>);
        },
        onBlur: () => {
          onFocusChange(false);
          onBlur();
        },
      }}
    >
      <TechnicianBadge frame={frame} a={a} b={b} name={technician.name} busy={busy} />
    </Hotspot>
  );
}

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

/**
 * The name plate: what this lift is, what it is doing, and how far along.
 * The bar sits across the anchor so the leader line still reaches the pad.
 */
function LiftLabel({
  frame,
  zone,
  name,
  status,
  tone,
  bar = null,
  barWidth = 96,
  alarmHatchId,
  dimmed = false,
  topZ = LIFT_LABEL_Z,
  tickZ = PLATFORM_Z + 0.15,
}: {
  frame: IsoFrame;
  zone: IsoZone;
  name: string;
  status: string;
  tone: Tone;
  bar?: LiftBarView | null;
  barWidth?: number;
  alarmHatchId?: string;
  dimmed?: boolean;
  topZ?: number;
  tickZ?: number;
}) {
  const centre = zoneCentre(zone);
  const anchor = frame.project(centre.a, zone.b0 - 0.15, topZ);
  const tick = frame.project(centre.a, zone.b0 - 0.15, tickZ);
  // The plate stacks upward from the anchor so the leader line keeps the same
  // clearance to the pad whether or not there is a bar to show.
  const nameY = bar ? anchor.y - 31 : anchor.y - 11;
  const statusY = bar ? anchor.y - 20 : anchor.y;
  return (
    <g pointerEvents="none" opacity={dimmed ? 0.32 : 1}>
      <line x1={anchor.x} y1={anchor.y + 4} x2={tick.x} y2={tick.y} stroke="var(--rule-2)" strokeWidth={0.9} />
      <circle cx={tick.x} cy={tick.y} r={1.8} fill="var(--rule-2)" />
      <IsoText x={anchor.x} y={nameY} tone="ink" size={11}>
        {name}
      </IsoText>
      <IsoText x={anchor.x} y={statusY} tone={tone} size={8.5}>
        {status}
      </IsoText>
      {bar ? (
        <>
          <IsoText x={anchor.x} y={anchor.y - 10} tone={bar.tone === "alarm" ? "alarm" : "muted"} size={7.5}>
            {bar.caption}
          </IsoText>
          <LabelBar
            x={anchor.x}
            y={anchor.y - 5}
            width={barWidth}
            fraction={bar.fraction}
            tone={bar.tone}
            hatchId={bar.hatched ? alarmHatchId : undefined}
          />
        </>
      ) : null}
    </g>
  );
}

/** A drafting gauge: ruled trough, measured fill. No gradient, no rounding. */
function LabelBar({
  x,
  y,
  width,
  fraction,
  tone,
  hatchId,
}: {
  x: number;
  y: number;
  width: number;
  fraction: number;
  tone: Tone;
  hatchId?: string;
}) {
  const height = 5;
  const left = x - width / 2;
  return (
    <g>
      <rect
        x={left}
        y={y}
        width={width}
        height={height}
        fill="var(--paper)"
        stroke="var(--rule)"
        strokeWidth={0.9}
      />
      <rect
        x={left}
        y={y}
        width={Math.max(0, fraction * width)}
        height={height}
        fill={hatchId ? `url(#${hatchId})` : STROKE[tone]}
      />
      {/* Mid-point tick: a gauge, not a loading bar. */}
      <line
        x1={left + width / 2}
        y1={y - 1.5}
        x2={left + width / 2}
        y2={y + height + 1.5}
        stroke="var(--rule-2)"
        strokeWidth={0.8}
      />
    </g>
  );
}

/**
 * The live route while a car is in flight: from its slot in the lot, bent
 * through the drive aisle, to wherever the pointer is — snapping to the lift
 * under it. Agent blue and dashed, the same language the plan routes use,
 * because it is the same decision made by hand.
 */
function DragRoute({ frame, drag }: { frame: IsoFrame; drag: FloorDrag }) {
  const target = drag.over ? LIFTS.find((zone) => zone.resourceId === drag.over) : undefined;
  const start = frame.project(drag.from.a, drag.from.b);
  const end = target
    ? frame.project(liftEntry(target).a, liftEntry(target).b)
    : drag.point;
  if (!end) return null;
  const via = frame.project((drag.from.a + (target ? zoneCentre(target).a : drag.from.a + 4)) / 2, 4.7);
  const control = { x: (via.x + (start.x + end.x) / 2) / 2, y: (via.y + (start.y + end.y) / 2) / 2 };
  const d = `M${start.x.toFixed(1)} ${start.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
  return (
    <g pointerEvents="none">
      <path d={d} fill="none" stroke="var(--agent)" strokeWidth={1.8} strokeDasharray="8 5" />
      <path
        d={chevron(end, { x: end.x - control.x, y: end.y - control.y }, 8)}
        fill="none"
        stroke="var(--agent)"
        strokeWidth={1.8}
      />
      <circle cx={start.x} cy={start.y} r={3} fill="var(--agent)" />
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
  leaving,
}: {
  frame: IsoFrame;
  waiting: number;
  overflow: number;
  leaving: number;
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
        {leaving > 0 ? `Exit · ${leaving}` : "Exit"}
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
