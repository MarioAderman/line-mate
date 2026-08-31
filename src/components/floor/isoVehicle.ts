/**
 * Volumetric vehicles for the isometric floor.
 *
 * The Board keeps the flat side-view family (`src/components/vehicles`). The
 * Floor cannot: a side silhouette extruded sideways reads as an upright slab,
 * not a car. So a floor vehicle is modelled as a small solid and projected
 * through the same `IsoFrame` as the building:
 *
 *   - a lower body swept across the full track, with wheel arches cut into it;
 *   - a narrower greenhouse on top (tumblehome), so the roof is inset;
 *   - the planes between the two sides — deck, hood, backlight, roof,
 *     windshield, fascia — drawn as real surfaces;
 *   - wheels drawn as circles inside the side plane, which the projection
 *     turns into correctly-raked ellipses, plus a contact footprint.
 *
 * Model space is `(u, v, w)`: `u` runs 0 (tail) to 1 (nose), `v` across the
 * body, `w` up from the ground. All three are measured in units of the
 * vehicle's own length, so proportions are physical and every kind keeps its
 * own stance. Pure geometry — no React, no colours, no store.
 */
import type { VehicleKind } from "@/components/derive";
import type { IsoFrame, IsoPoint } from "./iso";
import { pointsToPath } from "./iso";

/** Which plan axis the vehicle's nose points along. */
export type IsoHeading = "a+" | "a-" | "b+" | "b-";

/** Floor-local body families. Finer than the Board's three silhouettes. */
export type IsoBodyKind = "sedan" | "coupe" | "hatch" | "wagon" | "suv" | "van" | "pickup";

type Pt = [number, number];

interface BodyProfile {
  /** Track width, in units of vehicle length. */
  width: number;
  /** Greenhouse width as a fraction of the track — the tumblehome. */
  cabinWidth: number;
  /** Underbody height at the rocker. */
  clearance: number;
  wheelRadius: number;
  wheelAt: [number, number];
  /** Beltline, tail to nose: the top edge of everything below the glass. */
  belt: Pt[];
  /** Greenhouse: belt-rear, backlight top, roof front, belt-front. */
  cabin: [Pt, Pt, Pt, Pt];
}

const PROFILES: Record<IsoBodyKind, BodyProfile> = {
  sedan: {
    width: 0.44,
    cabinWidth: 0.8,
    clearance: 0.085,
    wheelRadius: 0.105,
    wheelAt: [0.205, 0.795],
    belt: [[0.025, 0.26], [0.09, 0.3], [0.72, 0.305], [0.955, 0.28], [0.995, 0.235]],
    cabin: [[0.285, 0.305], [0.415, 0.475], [0.665, 0.475], [0.775, 0.305]],
  },
  coupe: {
    width: 0.43,
    cabinWidth: 0.79,
    clearance: 0.08,
    wheelRadius: 0.1,
    wheelAt: [0.21, 0.8],
    belt: [[0.03, 0.25], [0.1, 0.29], [0.74, 0.295], [0.96, 0.27], [0.995, 0.225]],
    cabin: [[0.32, 0.295], [0.47, 0.435], [0.63, 0.435], [0.8, 0.295]],
  },
  hatch: {
    width: 0.44,
    cabinWidth: 0.8,
    clearance: 0.09,
    wheelRadius: 0.105,
    wheelAt: [0.215, 0.8],
    belt: [[0.02, 0.275], [0.06, 0.305], [0.72, 0.31], [0.955, 0.285], [0.995, 0.24]],
    cabin: [[0.115, 0.31], [0.29, 0.48], [0.665, 0.48], [0.775, 0.31]],
  },
  wagon: {
    width: 0.44,
    cabinWidth: 0.81,
    clearance: 0.09,
    wheelRadius: 0.105,
    wheelAt: [0.205, 0.8],
    belt: [[0.02, 0.28], [0.06, 0.305], [0.72, 0.31], [0.955, 0.285], [0.995, 0.24]],
    cabin: [[0.075, 0.31], [0.135, 0.495], [0.665, 0.495], [0.78, 0.31]],
  },
  suv: {
    width: 0.45,
    cabinWidth: 0.86,
    clearance: 0.115,
    wheelRadius: 0.125,
    wheelAt: [0.21, 0.8],
    belt: [[0.02, 0.3], [0.06, 0.335], [0.72, 0.345], [0.95, 0.325], [0.995, 0.275]],
    cabin: [[0.085, 0.345], [0.155, 0.565], [0.685, 0.565], [0.8, 0.345]],
  },
  van: {
    width: 0.46,
    cabinWidth: 0.88,
    clearance: 0.1,
    wheelRadius: 0.115,
    wheelAt: [0.2, 0.82],
    belt: [[0.015, 0.33], [0.06, 0.365], [0.8, 0.375], [0.96, 0.33], [0.995, 0.28]],
    cabin: [[0.045, 0.375], [0.085, 0.625], [0.79, 0.625], [0.955, 0.395]],
  },
  pickup: {
    width: 0.45,
    cabinWidth: 0.86,
    clearance: 0.11,
    wheelRadius: 0.12,
    wheelAt: [0.21, 0.8],
    belt: [[0.02, 0.36], [0.05, 0.4], [0.45, 0.4], [0.47, 0.325], [0.95, 0.31], [0.995, 0.265]],
    cabin: [[0.44, 0.33], [0.5, 0.55], [0.715, 0.55], [0.815, 0.33]],
  },
};

/**
 * Reads the body family off the fixture's free-text vehicle name, falling back
 * to the Board's coarser kind. Presentation only — the world has no opinion
 * about whether a car is a wagon.
 */
export function isoBodyKind(vehicle: string, kind: VehicleKind): IsoBodyKind {
  const v = vehicle.toLowerCase();
  if (v.includes("pickup") || v.includes("truck")) return "pickup";
  if (v.includes("van")) return "van";
  if (v.includes("suv") || v.includes("crossover")) return "suv";
  if (v.includes("wagon") || v.includes("estate")) return "wagon";
  if (v.includes("coupe")) return "coupe";
  if (v.includes("hatchback") || v.includes("compact")) return "hatch";
  if (v.includes("sedan") || v.includes("saloon")) return "sedan";
  return kind === "van" ? "van" : kind === "pickup" ? "pickup" : "sedan";
}

export interface IsoVehiclePlacement {
  frame: IsoFrame;
  bodyKind: IsoBodyKind;
  /** Centre of the footprint, in plan units. */
  a: number;
  b: number;
  /** Height of the surface it stands on, in plan units (a lift raises it). */
  z?: number;
  heading?: IsoHeading;
  /** Vehicle length, in plan units. Width and height follow the body family. */
  length?: number;
}

/** One projected surface of the solid, back to front. */
export interface IsoFace {
  d: string;
  /** Which token family the caller should fill it with. */
  surface: "far" | "shoulder" | "glass" | "roof" | "fascia";
}

export interface IsoVehicleDrawing {
  /** Contact patch on the ground, screen coordinates. */
  shadow: string;
  /** SVG transforms for drawing 2-D profile geometry in each side plane. */
  farPlane: string;
  nearPlane: string;
  /** The greenhouse is inset, so its sides need their own planes. */
  cabinFarPlane: string;
  cabinNearPlane: string;
  /** Model-space paths — draw inside a plane transform. */
  body: string;
  cabin: string;
  glass: string;
  beltline: string;
  doorLine: string;
  lamps: string;
  wheels: Array<{ cx: number; cy: number; r: number }>;
  /** Surfaces spanning the two sides, already projected. Draw in order. */
  faces: IsoFace[];
  /** Stroke scale so a hairline stays a hairline inside the plane transform. */
  bbox: { x: number; y: number; width: number; height: number };
  centre: IsoPoint;
}

const DEFAULT_LENGTH = 1.9;

const AXES: Record<IsoHeading, { dir: Pt; perp: Pt }> = {
  "a+": { dir: [1, 0], perp: [0, 1] },
  "a-": { dir: [-1, 0], perp: [0, -1] },
  "b+": { dir: [0, 1], perp: [-1, 0] },
  "b-": { dir: [0, -1], perp: [1, 0] },
};

function model(points: Pt[], close = true): string {
  const parts = points.map(([u, w], i) => `${i === 0 ? "M" : "L"}${u.toFixed(4)} ${w.toFixed(4)}`);
  return parts.join(" ") + (close ? " Z" : "");
}

export function isoVehicle(placement: IsoVehiclePlacement): IsoVehicleDrawing {
  const { frame, bodyKind, a, b, z = 0, heading = "a+", length = DEFAULT_LENGTH } = placement;
  const p = PROFILES[bodyKind];
  const { dir, perp } = AXES[heading];

  /** Model point -> plan coordinates. */
  const plan = (u: number, v: number) => ({
    a: a + dir[0] * (u - 0.5) * length + perp[0] * v * length,
    b: b + dir[1] * (u - 0.5) * length + perp[1] * v * length,
  });
  const pt = (u: number, v: number, w: number): IsoPoint => {
    const q = plan(u, v);
    return frame.project(q.a, q.b, z + w * length);
  };

  // The viewer stands below the drawing, so larger `a + b` is nearer.
  const half = p.width / 2;
  const depthAt = (v: number) => {
    const q = plan(0.5, v);
    return q.a + q.b;
  };
  const vNear = depthAt(half) > depthAt(-half) ? half : -half;
  const vFar = -vNear;
  const cabinNear = vNear * p.cabinWidth;
  const cabinFar = -cabinNear;

  const planeTransform = (v: number): string => {
    const origin = pt(0, v, 0);
    const along = pt(1, v, 0);
    return `matrix(${(along.x - origin.x).toFixed(4)} ${(along.y - origin.y).toFixed(4)} 0 ${(
      -length * frame.zUnit
    ).toFixed(4)} ${origin.x.toFixed(2)} ${origin.y.toFixed(2)})`;
  };

  /* ------------------------------------------------- 2-D profile geometry */

  const belt = p.belt;
  const [rearWheel, frontWheel] = p.wheelAt;
  const r = p.wheelRadius;
  const arch = (uc: number): string => {
    // A half arch, nose-side first: the body dips up over the wheel.
    const w = p.clearance;
    return (
      ` L${(uc + r * 1.16).toFixed(4)} ${w.toFixed(4)}` +
      ` A${(r * 1.16).toFixed(4)} ${(r * 1.16).toFixed(4)} 0 0 1 ${(uc - r * 1.16).toFixed(4)} ${w.toFixed(4)}`
    );
  };
  const noseEnd = belt[belt.length - 1];
  const tailEnd = belt[0];
  const bodyPath =
    model(belt, false) +
    ` L${noseEnd[0].toFixed(4)} ${p.clearance.toFixed(4)}` +
    arch(frontWheel) +
    arch(rearWheel) +
    ` L${tailEnd[0].toFixed(4)} ${p.clearance.toFixed(4)} Z`;

  const cabinPath = model([...p.cabin], true);
  const cu = (p.cabin[0][0] + p.cabin[3][0]) / 2;
  const base = (p.cabin[0][1] + p.cabin[3][1]) / 2;
  const glassPath = model(
    p.cabin.map(([u, w]) => [cu + (u - cu) * 0.82, base + (w - base) * 0.76] as Pt),
    true,
  );
  const pillar = (p.cabin[1][0] + p.cabin[2][0]) / 2;
  const doorLine = `M${pillar.toFixed(4)} ${base.toFixed(4)} L${pillar.toFixed(4)} ${p.clearance.toFixed(4)}`;
  const beltline = model(belt, false);
  const lampW = 0.035;
  const lamps =
    `M${(noseEnd[0] - lampW).toFixed(4)} ${(noseEnd[1] - 0.055).toFixed(4)} h${lampW.toFixed(4)} v0.05 h-${lampW.toFixed(4)} Z` +
    ` M${tailEnd[0].toFixed(4)} ${(tailEnd[1] - 0.05).toFixed(4)} h${lampW.toFixed(4)} v0.045 h-${lampW.toFixed(4)} Z`;

  /* ------------------------------------------- surfaces between the sides */

  const strip = (edge: Pt[], v0: number, v1: number): string =>
    pointsToPath([
      ...edge.map(([u, w]) => pt(u, v0, w)),
      ...[...edge].reverse().map(([u, w]) => pt(u, v1, w)),
    ]);

  const faces: IsoFace[] = [
    // Deck, cowl and hood: the shelf the greenhouse sits on.
    { d: strip(belt, vNear, vFar), surface: "shoulder" },
    { d: strip([p.cabin[0], p.cabin[1]], cabinNear, cabinFar), surface: "glass" },
    { d: strip([p.cabin[1], p.cabin[2]], cabinNear, cabinFar), surface: "roof" },
    { d: strip([p.cabin[2], p.cabin[3]], cabinNear, cabinFar), surface: "glass" },
  ];

  // Only the end turned towards the viewer shows its fascia.
  const noseDepth = (() => {
    const q = plan(1, 0);
    return q.a + q.b;
  })();
  const tailDepth = (() => {
    const q = plan(0, 0);
    return q.a + q.b;
  })();
  const end = noseDepth > tailDepth ? noseEnd : tailEnd;
  faces.push({
    d: strip(
      [
        [end[0], end[1]],
        [end[0], p.clearance],
      ],
      vNear,
      vFar,
    ),
    surface: "fascia",
  });

  /* ------------------------------------------------------- bounds & shape */

  const footprint = pointsToPath([
    pt(0.02, vNear, 0),
    pt(0.98, vNear, 0),
    pt(0.98, vFar, 0),
    pt(0.02, vFar, 0),
  ]);

  const top = Math.max(...p.cabin.map(([, w]) => w));
  const corners: IsoPoint[] = [];
  for (const u of [0, 1]) {
    for (const v of [vNear, vFar]) {
      for (const w of [0, top]) corners.push(pt(u, v, w));
    }
  }
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);

  return {
    shadow: footprint,
    farPlane: planeTransform(vFar),
    nearPlane: planeTransform(vNear),
    cabinFarPlane: planeTransform(cabinFar),
    cabinNearPlane: planeTransform(cabinNear),
    body: bodyPath,
    cabin: cabinPath,
    glass: glassPath,
    beltline,
    doorLine,
    lamps,
    wheels: [rearWheel, frontWheel].map((u) => ({ cx: u, cy: r, r })),
    faces,
    bbox: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
    centre: frame.project(a, b, z),
  };
}

