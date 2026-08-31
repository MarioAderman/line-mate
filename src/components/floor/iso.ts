/**
 * Isometric projection maths and the frozen shop plan.
 *
 * Everything the Isometric Shop draws is expressed in *plan units* on two
 * axes — `a` runs along the shop (screen right-and-down) and `b` runs across
 * it (screen left-and-down) — plus a vertical `z` in plan units. The frame
 * turns those into pixels for one concrete content box, so the same layout
 * fills the 1160x865 laptop pane and the 1567x995 monitor pane without
 * clipping and without a second set of coordinates.
 *
 * No React, no store, no colours: this file is pure geometry.
 */

export interface IsoPoint {
  x: number;
  y: number;
}

/** Rectangular footprint on the shop plan. */
export interface IsoZone {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/** The shop's outline in plan units. Roughly square, a little longer than deep. */
export const PLAN_A = 13;
export const PLAN_B = 11;
const SPAN = PLAN_A + PLAN_B;

/** Room kept for lift labels above the floor and the caption below it. */
const PAD_X = 16;
const PAD_TOP = 44;
const PAD_BOTTOM = 24;

/** Heights of the built objects, in plan units — the drawing's vertical scale. */
export const PLATFORM_Z = 0.58;
export const POST_Z = PLATFORM_Z + 0.66;
/** The highest thing drawn: the leader tick and name plate over a lift. */
export const LIFT_LABEL_Z = PLATFORM_Z + 1.15;
/** Room a two-line name plate needs above its anchor. */
const LABEL_TEXT_PX = 24;

/**
 * How steep the projection is (`halfW / halfH`). Letting it flex inside this
 * band is what makes one layout fill two very different content boxes; going
 * outside it stops reading as an isometric drawing.
 */
const MIN_RATIO = 1.68;
const MAX_RATIO = 2.15;

/* --------------------------------------------------------------- the plan */

export interface LiftZone extends IsoZone {
  resourceId: string;
}

/** Three lifts across the back wall, in resource order. */
export const LIFTS: LiftZone[] = [
  { resourceId: "bay-1", a0: 1.05, a1: 3.75, b0: 0.7, b1: 3.5 },
  { resourceId: "bay-2", a0: 4.25, a1: 6.95, b0: 0.7, b1: 3.5 },
  { resourceId: "bay-3", a0: 7.45, a1: 10.15, b0: 0.7, b1: 3.5 },
];

/** Diagnostics pad, front-right. */
export const DIAGNOSTICS: LiftZone = {
  resourceId: "diag-1",
  a0: 9.5,
  a1: 12.4,
  b0: 7.3,
  b1: 10.5,
};

/** Waiting lot, front-left. */
export const LOT: IsoZone = { a0: 0.25, a1: 4.45, b0: 5.85, b1: 10.95 };

/** Exit strip on the right edge; cars leave towards b = 0. */
export const EXIT: IsoZone = { a0: 10.5, a1: 13.0, b0: 0.3, b1: 5.3 };

/** Delivery apron just outside the right wall, and the parts van on it. */
export const PARTS_APRON: IsoZone = { a0: 13.25, a1: 14.75, b0: 1.7, b1: 5.5 };
export const PARTS_VAN = { a: 13.95, b: 3.6 };

/** Eight marked bays in the waiting lot, back row first. */
export const LOT_SLOTS: Array<{ a: number; b: number }> = [1.2, 3.5].flatMap((a) =>
  [6.6, 7.85, 9.1, 10.35].map((b) => ({ a, b })),
);

/** Three marked positions in the exit strip, nearest the door first. */
export const EXIT_SLOTS: Array<{ a: number; b: number }> = [1.2, 2.8, 4.4].map((b) => ({
  a: 11.7,
  b,
}));

/** Where a technician stands while working a given resource. */
export const TECH_POSTS: Record<string, { a: number; b: number }> = {
  "bay-1": { a: 1.5, b: 4.15 },
  "bay-2": { a: 4.7, b: 4.15 },
  "bay-3": { a: 7.9, b: 4.15 },
  "diag-1": { a: 8.75, b: 8.6 },
};

/** Idle technicians wait in the drive aisle between the lifts and the lot. */
export const TECH_AISLE: Array<{ a: number; b: number }> = [2.3, 3.9, 5.5].map((a) => ({
  a,
  b: 5.15,
}));

/** Where cars leave the lot and join the drive aisle. */
export const LOT_GATE = { a: 4.85, b: 7.2 };

/** Front-centre of a lift pad — the point flow paths and routes aim at. */
export function liftEntry(zone: IsoZone): { a: number; b: number } {
  return { a: (zone.a0 + zone.a1) / 2, b: zone.b1 + 0.35 };
}

/* ------------------------------------------------------------- projection */

export interface IsoFrame {
  width: number;
  height: number;
  /** Half the screen width of one plan tile. */
  halfW: number;
  /** Half the screen height of one plan tile. */
  halfH: number;
  /** Pixels per plan unit of height. */
  zUnit: number;
  project(a: number, b: number, z?: number): IsoPoint;
  /** Closed path for a plan rectangle lying at height `z`. */
  quad(zone: IsoZone, z?: number): string;
  /** Closed path for a vertical face between two plan points. */
  face(a0: number, b0: number, a1: number, b1: number, z0: number, z1: number): string;
  /** Painter's-algorithm key: larger is nearer the viewer. */
  depth(a: number, b: number): number;
}

export function createIsoFrame(width: number, height: number): IsoFrame {
  // Two passes: the label band above the back lifts scales with the vertical
  // unit, so how much headroom the drawing needs is only known once the tile
  // size is. Without this the monitor preset clips its own "BAY 1" plate.
  const fit = (padTop: number) => {
    let halfW = Math.max(6, (width - PAD_X * 2) / SPAN);
    let halfH = Math.max(3, (height - padTop - PAD_BOTTOM) / SPAN);
    const ratio = halfW / halfH;
    if (ratio < MIN_RATIO) halfH = halfW / MIN_RATIO;
    else if (ratio > MAX_RATIO) halfW = halfH * MAX_RATIO;
    return { halfW, halfH };
  };
  const first = fit(PAD_TOP);
  const backTiles = LIFTS[0].b0 - 0.15 + (LIFTS[0].a0 + LIFTS[0].a1) / 2;
  const headroom = LIFT_LABEL_Z * first.halfW - backTiles * first.halfH + LABEL_TEXT_PX;
  const padTop = Math.max(PAD_TOP, headroom);
  const { halfW, halfH } = fit(padTop);

  const planHeight = SPAN * halfH;
  // Centre the diamond horizontally; keep it under the label band vertically.
  const ox = width / 2 + ((PLAN_B - PLAN_A) / 2) * halfW;
  const oy = padTop + Math.max(0, (height - padTop - PAD_BOTTOM - planHeight) / 2);
  const zUnit = halfW;

  const project = (a: number, b: number, z = 0): IsoPoint => ({
    x: ox + (a - b) * halfW,
    y: oy + (a + b) * halfH - z * zUnit,
  });

  const quad = (zone: IsoZone, z = 0): string => {
    const p = [
      project(zone.a0, zone.b0, z),
      project(zone.a1, zone.b0, z),
      project(zone.a1, zone.b1, z),
      project(zone.a0, zone.b1, z),
    ];
    return `M${round(p[0])} L${round(p[1])} L${round(p[2])} L${round(p[3])} Z`;
  };

  const face = (a0: number, b0: number, a1: number, b1: number, z0: number, z1: number): string => {
    const p = [
      project(a0, b0, z0),
      project(a1, b1, z0),
      project(a1, b1, z1),
      project(a0, b0, z1),
    ];
    return `M${round(p[0])} L${round(p[1])} L${round(p[2])} L${round(p[3])} Z`;
  };

  return {
    width,
    height,
    halfW,
    halfH,
    zUnit,
    project,
    quad,
    face,
    depth: (a, b) => a + b,
  };
}

function round(p: IsoPoint): string {
  return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
}

export function pointsToPath(points: IsoPoint[], close = true): string {
  if (points.length === 0) return "";
  const [head, ...rest] = points;
  return `M${round(head)}${rest.map((p) => ` L${round(p)}`).join("")}${close ? " Z" : ""}`;
}

export function zoneCentre(zone: IsoZone): { a: number; b: number } {
  return { a: (zone.a0 + zone.a1) / 2, b: (zone.b0 + zone.b1) / 2 };
}

export function inflate(zone: IsoZone, amount: number): IsoZone {
  return {
    a0: zone.a0 - amount,
    a1: zone.a1 + amount,
    b0: zone.b0 - amount,
    b1: zone.b1 + amount,
  };
}

