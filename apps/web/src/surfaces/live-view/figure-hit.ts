import { type FigureBounds, figureBoundsOf } from "./art/figures.ts";
import { type Point, type View, scaleOf, toArtPoint, toCanvas } from "./view.ts";

/** What hit-testing needs of a figure on the floor. */
export interface FigureHitBox {
  readonly roleKey: string;
  /** The figure's feet (a lying figure's middle), in art pixels. */
  readonly feet: Point;
  /** Draw order: a higher depth is drawn in front. */
  readonly depth: number;
  /** Where the figure reaches from its feet, by its pose (`figureBoundsOf`). */
  readonly bounds: FigureBounds;
  /** Gone out of the door (home for the night): not drawn, so never pressed. */
  readonly gone?: boolean;
}

/** Where a figure's head and feet are on the canvas, in CSS pixels, to anchor its tooltip or popover. */
export interface FigureAnchor {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

/** How far under the feet a nameplate hangs, in art pixels. */
export const NAMEPLATE_BELOW_FEET = 4;
/** How high over an upright figure's feet its tooltip is anchored, in art pixels. */
const ANCHOR_OVER_FEET = 24;
/** How far over the head's top a tooltip is anchored at most, in art pixels: a lying figure's is lower. */
const ANCHOR_OVER_HEAD = 4;

const UPRIGHT = figureBoundsOf("stand-front");

/** The figure under a point of the canvas (CSS pixels), front-most first. Nameplates are HTML with their own events. */
export function figureAt(
  point: Point,
  view: View,
  figures: readonly FigureHitBox[],
): string | null {
  const art = toArtPoint(view, point);
  const frontFirst = figures.toSorted((a, b) => b.depth - a.depth);
  for (const figure of frontFirst) {
    if (figure.gone) continue;
    const { x, y } = figure.feet;
    const { left, right, top, bottom } = figure.bounds;
    if (art.x >= x + left && art.x <= x + right && art.y >= y + top && art.y <= y + bottom) {
      return figure.roleKey;
    }
  }
  return null;
}

/** From over the head to just under the feet; a lying figure's from lower, to under its feet. */
export function figureAnchor(
  view: View,
  feet: Point,
  bounds: FigureBounds = UPRIGHT,
): FigureAnchor {
  const at = toCanvas(view, feet);
  const scale = scaleOf(view);
  const over = Math.min(ANCHOR_OVER_FEET, bounds.head + ANCHOR_OVER_HEAD);
  const under = Math.max(NAMEPLATE_BELOW_FEET, bounds.bottom);
  return { x: at.x, top: at.y - over * scale, bottom: at.y + under * scale };
}
