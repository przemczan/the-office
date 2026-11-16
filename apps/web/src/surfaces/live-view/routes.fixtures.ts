import { AISLE_ROW, DOOR_OUTSIDE, consultSpot, deskSpot } from "./floor-plan.ts";
import type { Amenities, FloorPoint, Layout, Spot } from "./live-view-types.ts";
import type { RouteFloor } from "./routes.ts";

/** Every spot a figure can be sent to: desks, Consultants' desks, meeting seats, pastimes' spots, the door. */
export function spotsOf(layout: Layout, amenities: Amenities): Spot[] {
  return [
    ...layout.desks.map(deskSpot),
    ...layout.desks.filter((desk) => desk.group === "consultants").map(consultSpot),
    ...amenities.meetingSeats,
    ...amenities.pastimeSpots,
    DOOR_OUTSIDE,
  ];
}

function tileOf(point: FloorPoint): FloorPoint {
  return { x: Math.floor(point.x), y: Math.floor(point.y) };
}

function isBlocked(floor: RouteFloor, tile: FloorPoint): boolean {
  // Past the door, outside the room, on the aisle's row: the one way out.
  if (tile.x < 0) return tile.y !== AISLE_ROW;
  if (tile.y < 0 || tile.x >= floor.width || tile.y >= floor.depth) return true;
  return floor.walkable[tile.y * floor.width + tile.x] !== 1;
}

/**
 * The blocked tiles a route passes over, sampled every 0.1 tile along each segment, leaving out
 * the tiles under its two ends (a seat's or a desk chair's own tile is blocked by its furniture).
 */
export function blockedCrossings(floor: RouteFloor, route: readonly FloorPoint[]): string[] {
  const first = tileOf(route[0]!);
  const last = tileOf(route[route.length - 1]!);
  const ends = new Set([`${first.x},${first.y}`, `${last.x},${last.y}`]);
  const crossings = new Set<string>();
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1]!;
    const to = route[i]!;
    const samples = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.1));
    for (let s = 0; s <= samples; s++) {
      const tile = tileOf({
        x: from.x + ((to.x - from.x) * s) / samples,
        y: from.y + ((to.y - from.y) * s) / samples,
      });
      const key = `${tile.x},${tile.y}`;
      if (!ends.has(key) && isBlocked(floor, tile)) crossings.add(key);
    }
  }
  return [...crossings];
}
