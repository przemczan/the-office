import { HALF_H, HALF_W, WALL_H, isoX, isoY } from "./art/iso.ts";
import type { FloorPoint, Layout } from "./live-view-types.ts";

/** A rectangle in the art's pixels. */
export interface ArtRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the floor's (0, 0) lands in the office's art, and the art's whole size. */
export interface OfficeGeometry {
  readonly origin: FloorPoint;
  readonly width: number;
  readonly height: number;
}

export function officeGeometryOf(layout: Layout): OfficeGeometry {
  return {
    origin: { x: (layout.depth + 1) * HALF_W + 12, y: WALL_H + 30 },
    width: (layout.width + layout.depth + 2) * HALF_W + 24,
    height: (layout.width + layout.depth) * HALF_H + WALL_H + 64,
  };
}

/** The whole office in the art's pixels, with room for the nameplates under the front row. */
export function officeBounds(layout: Layout, geometry: OfficeGeometry): ArtRect {
  const { width, depth } = layout;
  const left = geometry.origin.x + isoX(0, depth) - 6;
  const right = geometry.origin.x + isoX(width, 0) + 6;
  const top = geometry.origin.y + isoY(0, 0, WALL_H) - 8;
  const bottom = geometry.origin.y + isoY(width, depth) + 16;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A floor point, in tiles and a height in pixels, as a whole art pixel. */
export function toArt(geometry: OfficeGeometry, x: number, y: number, z = 0): FloorPoint {
  return {
    x: Math.round(geometry.origin.x + isoX(x, y)),
    y: Math.round(geometry.origin.y + isoY(x, y, z)),
  };
}
