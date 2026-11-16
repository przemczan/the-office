import type { DeskGroup, Layout } from "../live-view-types.ts";
import { WALL_H } from "./iso.ts";
import { ART as A, GROUP_ART } from "./palettes.ts";
import type { IsoPen } from "./pixel-grid.ts";

/* As floor-plan.ts lays the floor out: the main aisle's row, from the door, and the first pod row. */
const AISLE_ROW = 3;
const POD_TOP = 4;

/** Where the windows start along the back wall (x) and the left wall (y), in tiles; each is 1.4 wide. */
export interface Windows {
  readonly back: readonly number[];
  readonly left: readonly number[];
}

export function windowsOf(layout: Layout): Windows {
  const back: number[] = [];
  for (let x = 5.3; x + 1.4 <= layout.width - 0.4; x += 3) back.push(x);
  const left: number[] = [];
  for (let y = POD_TOP + 1.3; y + 1.4 <= layout.depth - 0.4; y += 3) left.push(y);
  return { back, left };
}

interface Pod {
  readonly x: number;
  top: number;
  bottom: number;
  readonly group: DeskGroup;
}

/** The floor's still layer: the boards, each pod's carpet and the meeting spot's and chill area's rugs. */
export function paintFloorLayer(pen: IsoPen, layout: Layout): void {
  const { width: W, depth: D } = layout;
  pen.floor(0, 0, W, D, A.floorA);
  for (let y = 0; y <= D; y++) pen.line([0, y, 0], [W, y, 0], A.floorSeam);
  for (let y = 0; y < D; y++) {
    for (let x = y % 2 ? 0.5 : 1; x < W; x += 1.5) pen.line([x, y, 0], [x, y + 1, 0], A.floorSeam);
  }
  // Each pod's carpet, in its group's colour.
  const pods = new Map<string, Pod>();
  for (const desk of layout.desks) {
    const top = desk.y - ((desk.y - POD_TOP) % (2 * layout.perPod + 1));
    const key = `${desk.column.x}:${top}`;
    const pod = pods.get(key) ?? {
      x: desk.column.x,
      top: desk.y,
      bottom: desk.y + 2,
      group: desk.group,
    };
    pod.bottom = Math.max(pod.bottom, desk.y + 2);
    pod.top = Math.min(pod.top, desk.y);
    pods.set(key, pod);
  }
  for (const pod of pods.values()) {
    const art = GROUP_ART[pod.group];
    pen.floor(pod.x - 0.15, pod.top - 0.15, pod.x + 2.15, pod.bottom + 0.15, art.carpetEdge);
    pen.floor(pod.x - 0.05, pod.top - 0.05, pod.x + 2.05, pod.bottom + 0.05, art.carpet);
  }
  // The meeting spot's rug and the chill area's.
  pen.floor(1.15, 0.25, 3.85, 2.95, A.meetingRugEdge);
  pen.floor(1.25, 0.35, 3.75, 2.85, A.meetingRug);
  const s0 = layout.chillStart;
  pen.floor(s0 + 0.3, 0.95, s0 + layout.sofaSeats + 2.9, 2.95, A.rugEdge);
  pen.floor(s0 + 0.4, 1.05, s0 + layout.sofaSeats + 2.8, 2.85, A.rug);
  pen.floor(s0 + 0.65, 1.3, s0 + layout.sofaSeats + 2.55, 2.6, A.rugInner);
  pen.floor(s0 + 0.75, 1.4, s0 + layout.sofaSeats + 2.45, 2.5, A.rug);
}

type WallFace = (from: number, to: number, z0: number, z1: number, index: number) => void;

/** A window on a wall face: a frame, the glass in two bands, the bars and the sill. */
function paintWindow(face: WallFace, from: number): void {
  face(from - 0.05, from + 1.45, 14, 15, A.sill);
  face(from, from + 1.4, 15, 38, A.frame);
  face(from + 0.1, from + 1.3, 17, 27, A.glass);
  face(from + 0.1, from + 1.3, 27, 36, A.glassHigh);
  face(from + 0.66, from + 0.74, 17, 36, A.frame);
  face(from + 0.1, from + 1.3, 26.5, 27.5, A.frame);
}

/** Sunlight through each window: a patch on the floor in palette index 1, tinted by the hour. */
export function paintSunPatches(pen: IsoPen, layout: Layout): void {
  const { back, left } = windowsOf(layout);
  for (const x of back) {
    pen.grid.polygon(
      [
        pen.point(x + 0.1, 0.05),
        pen.point(x + 1.3, 0.05),
        pen.point(x + 1.9, 1.7),
        pen.point(x + 0.7, 1.7),
      ],
      1,
    );
  }
  for (const y of left) {
    pen.grid.polygon(
      [
        pen.point(0.05, y + 0.1),
        pen.point(0.05, y + 1.3),
        pen.point(1.6, y + 1.9),
        pen.point(1.6, y + 0.7),
      ],
      1,
    );
  }
}

/**
 * The back and left walls, the whiteboard, the windows and the exit sign. The glass, its stars and
 * the exit sign are painted again over this, untinted, by the sky's palette (`SKY_PALETTES`): the
 * stage paints the same grid with only those indexes.
 */
export function paintWalls(pen: IsoPen, layout: Layout): void {
  const { width: W, depth: D } = layout;
  const T = 0.25;
  // The back wall (along x) and the left wall (along y), their tops and their ends.
  pen.faceY(0, 0, W, 0, WALL_H, A.wallFace);
  pen.faceY(0, 0, W, 0, 3, A.baseboard);
  pen.faceX(W, -T, 0, 0, WALL_H, A.wallSide);
  pen.faceX(0, 0, D, 0, WALL_H, A.wallSide);
  pen.faceX(0, 0, D, 0, 3, A.baseboard);
  pen.faceY(D, -T, 0, 0, WALL_H, A.wallFace);
  pen.grid.polygon(
    [
      pen.point(-T, -T, WALL_H),
      pen.point(W, -T, WALL_H),
      pen.point(W, 0, WALL_H),
      pen.point(0, 0, WALL_H),
      pen.point(0, D, WALL_H),
      pen.point(-T, D, WALL_H),
    ],
    A.wallTop,
  );
  // The whiteboard behind the meeting spot.
  pen.faceY(0, 1.35, 3.65, 13, 34, A.boardFrame);
  pen.faceY(0, 1.45, 3.55, 14, 33, A.board);
  pen.line([1.7, 0, 29], [2.6, 0, 29], A.ink);
  pen.line([1.7, 0, 26], [2.3, 0, 26], A.ink);
  pen.line([1.7, 0, 23], [2.8, 0, 23], A.ink);
  pen.line([2.95, 0, 20], [3.35, 0, 27], A.inkRed);
  pen.line([2.95, 0, 27], [3.35, 0, 20], A.inkRed);
  // Windows: a frame, the glass in two bands, the bars and the sill; the sky paints the glass.
  const { back, left } = windowsOf(layout);
  for (const x of back) paintWindow((a, b, z0, z1, index) => pen.faceY(0, a, b, z0, z1, index), x);
  for (const y of left) paintWindow((a, b, z0, z1, index) => pen.faceX(0, a, b, z0, z1, index), y);
  // A few stars, which show only in the night sky's palette (`glassStar` is the glass's own by day).
  back.forEach((x, i) => {
    pen.faceY(0, x + 0.25 + (i % 2) * 0.2, x + 0.3 + (i % 2) * 0.2, 33, 34, A.glassStar);
    pen.faceY(0, x + 0.95, x + 1.0, 30 + (i % 3), 31 + (i % 3), A.glassStar);
  });
  left.forEach((y, i) =>
    pen.faceX(0, y + 0.4 + (i % 2) * 0.3, y + 0.45 + (i % 2) * 0.3, 32, 33, A.glassStar),
  );
  // The exit sign over the door.
  pen.faceX(0, AISLE_ROW + 0.28, AISLE_ROW + 0.72, 37, 41, A.exitSign);
  pen.faceX(0, AISLE_ROW + 0.36, AISLE_ROW + 0.64, 38, 40, A.exitSignInk);
}
