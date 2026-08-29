/**
 * Side-view vehicle silhouettes as SVG path strings, so both the React
 * components and raw `<svg>` string builders draw exactly the same shapes.
 * Placeholders until Mario settles the final artwork source; swapping them is
 * a change to this file only.
 */
import type { VehicleKind } from "@/components/derive";

export interface GlyphBox {
  width: number;
  height: number;
}

export const GLYPH_BOX: GlyphBox = { width: 72, height: 34 };

/** Body outline for a vehicle drawn in a `GLYPH_BOX`. */
export function bodyPath(kind: VehicleKind, w = GLYPH_BOX.width, h = GLYPH_BOX.height): string {
  const r = (v: number) => v.toFixed(0);
  if (kind === "van") {
    return `M2 ${h - 8} V6 q0-4 4-4 H${r(w * 0.62)} l${r(w * 0.22)} 8 V${h - 8} q0 3-3 3 H5 q-3 0-3-3 z`;
  }
  if (kind === "pickup") {
    return `M2 ${h - 8} V12 q0-3 3-3 H${r(w * 0.42)} V5 q0-3 3-3 H${r(w * 0.62)} l${r(w * 0.2)} 9 H${w - 3} q3 0 3 3 V${h - 8} q0 3-3 3 H5 q-3 0-3-3 z`;
  }
  return `M2 ${h - 8} V15 q0-3 3-3 H${r(w * 0.2)} l${r(w * 0.14)}-8 H${r(w * 0.62)} l${r(w * 0.2)} 8 H${w - 4} q4 0 4 4 V${h - 8} q0 3-3 3 H5 q-3 0-3-3 z`;
}

/** Window outline(s), lighter stroke. */
export function windowPath(kind: VehicleKind, w = GLYPH_BOX.width, h = GLYPH_BOX.height): string {
  const r = (v: number) => v.toFixed(0);
  if (kind === "van") {
    return `M${r(w * 0.66)} 7 h${r(w * 0.16)} v9 h-${r(w * 0.16)} z M8 7 h${r(w * 0.5)} v9 H8 z`;
  }
  if (kind === "pickup") {
    return `M${r(w * 0.46)} 6 h${r(w * 0.16)} v8 h-${r(w * 0.16)} z`;
  }
  return `M${r(w * 0.24)} 12 l${r(w * 0.1)}-6 H${r(w * 0.46)} V12 z M${r(w * 0.5)} 12 V6 H${r(w * 0.6)} l${r(w * 0.14)} 6 z`;
}

export function wheelCenters(w = GLYPH_BOX.width, h = GLYPH_BOX.height): Array<[number, number]> {
  return [
    [Math.round(w * 0.24), h - 6],
    [Math.round(w * 0.78), h - 6],
  ];
}

export interface GlyphStyle {
  stroke: string;
  fill?: string;
  strokeWidth?: number;
}

/** Complete glyph as an SVG fragment (no outer <svg>), for string-built SVG. */
export function vehicleGlyphMarkup(
  kind: VehicleKind,
  style: GlyphStyle,
  box: GlyphBox = GLYPH_BOX,
): string {
  const { width: w, height: h } = box;
  const fill = style.fill ?? "#ffffff";
  const sw = style.strokeWidth ?? 1.6;
  const wheels = wheelCenters(w, h)
    .map(
      ([cx, cy]) =>
        `<circle cx="${cx}" cy="${cy}" r="6" fill="${fill}" stroke="${style.stroke}" stroke-width="${sw}"/>` +
        `<circle cx="${cx}" cy="${cy}" r="2" fill="${style.stroke}"/>`,
    )
    .join("");
  return (
    `<path d="${bodyPath(kind, w, h)}" fill="${fill}" stroke="${style.stroke}" stroke-width="${sw}" stroke-linejoin="round"/>` +
    `<path d="${windowPath(kind, w, h)}" fill="none" stroke="${style.stroke}" stroke-width="1.1" opacity="0.7"/>` +
    wheels
  );
}
