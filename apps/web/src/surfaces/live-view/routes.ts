import { type Walkable, walkableOf } from "./floor-plan.ts";
import type { Amenities, FloorPoint, Layout, Spot } from "./live-view-types.ts";

/** What a route needs of the floor: its size in tiles and which tiles a figure may walk on. */
export interface RouteFloor {
  readonly width: number;
  readonly depth: number;
  readonly walkable: Walkable;
}

/** The floor as it stands now; made again after a hire takes a desk. */
export function routeFloorOf(layout: Layout, amenities: Amenities): RouteFloor {
  return { width: layout.width, depth: layout.depth, walkable: walkableOf(layout, amenities) };
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function isInside(floor: RouteFloor, tile: FloorPoint): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < floor.width && tile.y < floor.depth;
}

/**
 * A breadth-first search over the floor's tiles, four ways, so figures walk along its lines. The
 * start and goal tiles may be blocked (a seat's own tile is); every tile between must be walkable.
 * Null when there is no way through, so nobody ever walks through furniture.
 */
export function findTiles(
  floor: RouteFloor,
  from: FloorPoint,
  to: FloorPoint,
): FloorPoint[] | null {
  if (!isInside(floor, from) || !isInside(floor, to)) return null;
  const { width, depth, walkable } = floor;
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  const previous = new Int32Array(width * depth).fill(-1);
  previous[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    if (at === goal) break;
    const x = at % width;
    const y = Math.floor(at / width);
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= depth) continue;
      const next = ny * width + nx;
      if (previous[next] !== -1 || (walkable[next] !== 1 && next !== goal)) continue;
      previous[next] = at;
      queue.push(next);
    }
  }
  if (previous[goal] === -1) return null;
  const tiles: FloorPoint[] = [];
  for (let at = goal; at !== start; at = previous[at]!) {
    tiles.push({ x: at % width, y: Math.floor(at / width) });
  }
  tiles.push({ x: from.x, y: from.y });
  return tiles.toReversed();
}

/**
 * A walk from one spot to another round the furniture, as points to pass through: the spot, its
 * step out, the tiles' centres, the target's step in, the target. Points in a straight line are
 * merged. Null when either spot has no tile or no way through.
 */
export function routeBetween(floor: RouteFloor, from: Spot, to: Spot): FloorPoint[] | null {
  if (!from.tile || !to.tile) return null;
  const tiles = findTiles(floor, from.tile, to.tile);
  if (!tiles) return null;
  const points: FloorPoint[] = [{ x: from.x, y: from.y }];
  if (from.exit) points.push(from.exit);
  for (const tile of tiles) points.push({ x: tile.x + 0.5, y: tile.y + 0.5 });
  if (to.exit) points.push(to.exit);
  points.push({ x: to.x, y: to.y });
  const route: FloorPoint[] = [];
  for (const point of points) {
    const last = route[route.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) continue;
    const before = route[route.length - 2];
    if (before && last && isStraightOn(before, last, point)) route.pop();
    route.push({ x: point.x, y: point.y });
  }
  return route;
}

/** Whether `last` lies on the way from `before` to `next`, so it can be left out. */
function isStraightOn(before: FloorPoint, last: FloorPoint, next: FloorPoint): boolean {
  const cross = (last.x - before.x) * (next.y - last.y) - (last.y - before.y) * (next.x - last.x);
  const dot = (last.x - before.x) * (next.x - last.x) + (last.y - before.y) * (next.y - last.y);
  return Math.abs(cross) < 0.001 && dot > 0;
}

/** A route's length in tiles. */
export function routeLength(route: readonly FloorPoint[]): number {
  let length = 0;
  for (let i = 1; i < route.length; i++) {
    length += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  }
  return length;
}
