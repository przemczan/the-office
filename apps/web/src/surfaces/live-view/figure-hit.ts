import { type Point, type View, scaleOf, toArtPoint, toCanvas } from "./view.ts";

/** What hit-testing needs of a figure on the floor. */
export interface FigureHitBox {
  readonly roleKey: string;
  /** The figure's feet, in art pixels. */
  readonly feet: Point;
  /** Draw order: a higher depth is drawn in front. */
  readonly depth: number;
  readonly seated: boolean;
}

/** Where a figure's head and feet are on the canvas, in CSS pixels, to anchor its tooltip or popover. */
export interface FigureAnchor {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

const HALF_WIDTH = 8;
const STANDING_HEIGHT = 26;
const SEATED_HEIGHT = 22;
const BELOW_FEET = 2;

/** The figure under a point of the canvas (CSS pixels), front-most first. Nameplates are HTML with their own events. */
export function figureAt(
  point: Point,
  view: View,
  figures: readonly FigureHitBox[],
): string | null {
  const art = toArtPoint(view, point);
  const frontFirst = figures.toSorted((a, b) => b.depth - a.depth);
  for (const figure of frontFirst) {
    const height = figure.seated ? SEATED_HEIGHT : STANDING_HEIGHT;
    const { x, y } = figure.feet;
    if (
      art.x >= x - HALF_WIDTH &&
      art.x <= x + HALF_WIDTH &&
      art.y >= y - height &&
      art.y <= y + BELOW_FEET
    ) {
      return figure.roleKey;
    }
  }
  return null;
}

export function figureAnchor(view: View, feet: Point): FigureAnchor {
  const at = toCanvas(view, feet);
  const scale = scaleOf(view);
  return { x: at.x, top: at.y - 24 * scale, bottom: at.y + 4 * scale };
}
