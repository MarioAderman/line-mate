import type { VehicleKind } from "@/components/derive";
import { GLYPH_BOX, bodyPath, wheelCenters, windowPath } from "./glyphs";

interface Props {
  kind: VehicleKind;
  /** CSS colour; semantic tone is decided by the caller (ink / alarm / warn). */
  stroke: string;
  fill?: string;
  width?: number;
  className?: string;
  title?: string;
}

/**
 * Side-view vehicle, standalone `<svg>`. Use `VehicleGlyph` inside an
 * existing SVG (Board lanes, Floor) and this component in HTML flows
 * (promises strip, popovers).
 */
export function Vehicle({ kind, stroke, fill = "#ffffff", width = GLYPH_BOX.width, className, title }: Props) {
  const scale = width / GLYPH_BOX.width;
  const height = Math.round(GLYPH_BOX.height * scale);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${GLYPH_BOX.width} ${GLYPH_BOX.height}`}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", flex: "none" }}
    >
      {title && <title>{title}</title>}
      <VehicleGlyph kind={kind} stroke={stroke} fill={fill} />
    </svg>
  );
}

/** The same silhouette as a `<g>`, for SVG scenes. Origin = rear-bottom of the glyph box. */
export function VehicleGlyph({
  kind,
  stroke,
  fill = "#ffffff",
  x = 0,
  y = 0,
  scale = 1,
}: {
  kind: VehicleKind;
  stroke: string;
  fill?: string;
  x?: number;
  y?: number;
  scale?: number;
}) {
  const { width: w, height: h } = GLYPH_BOX;
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={bodyPath(kind, w, h)} fill={fill} stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" />
      <path d={windowPath(kind, w, h)} fill="none" stroke={stroke} strokeWidth={1.1} opacity={0.7} />
      {wheelCenters(w, h).map(([cx, cy]) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r={6} fill={fill} stroke={stroke} strokeWidth={1.6} />
          <circle cx={cx} cy={cy} r={2} fill={stroke} />
        </g>
      ))}
    </g>
  );
}
