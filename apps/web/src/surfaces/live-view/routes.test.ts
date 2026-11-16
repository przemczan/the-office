import { describe, expect, it } from "vitest";
import { DOOR_OUTSIDE, addHire, amenitiesOf, deskSpot, layoutOffice } from "./floor-plan.ts";
import { FLOOR_SIZES, floorPeopleOf, officePerson } from "./live-view.fixtures.ts";
import type { Layout } from "./live-view-types.ts";
import { blockedCrossings, spotsOf } from "./routes.fixtures.ts";
import { findTiles, routeBetween, routeFloorOf } from "./routes.ts";

/** A floor plan, and the same after three hires opened a pod at the right end. */
function floorPlans(): { readonly name: string; readonly layout: Layout }[] {
  return FLOOR_SIZES.flatMap((count) => {
    const grown = layoutOffice(floorPeopleOf(count));
    const widthBefore = grown.width;
    for (const roleKey of ["hire-a", "hire-b", "hire-c", "hire-d", "hire-e", "hire-f", "hire-g"]) {
      addHire(grown, officePerson(roleKey));
    }
    expect(grown.width).toBeGreaterThan(widthBefore);
    return [
      { name: `${count} people`, layout: layoutOffice(floorPeopleOf(count)) },
      { name: `${count} people after hires grew the floor`, layout: grown },
    ];
  });
}

describe.each(floorPlans())("routes on the floor of $name", ({ layout }) => {
  const amenities = amenitiesOf(layout);
  const floor = routeFloorOf(layout, amenities);
  const spots = spotsOf(layout, amenities);

  it("reaches every spot from a walkable tile", () => {
    for (const spot of spots) {
      const tile = spot.tile!;
      expect({ spot, walkable: floor.walkable[tile.y * floor.width + tile.x] }).toEqual({
        spot,
        walkable: 1,
      });
    }
  });

  it("walks from the door to every pastime's spot, never over furniture", () => {
    expect(amenities.pastimeSpots.length).toBeGreaterThan(0);
    for (const spot of amenities.pastimeSpots) {
      expect(findTiles(floor, DOOR_OUTSIDE.tile!, spot.tile)).not.toBeNull();
      const route = routeBetween(floor, DOOR_OUTSIDE, spot);
      expect(route).not.toBeNull();
      expect({ spot: spot.kind, crossings: blockedCrossings(floor, route!) }).toEqual({
        spot: spot.kind,
        crossings: [],
      });
    }
  });

  it("finds a way between every pair of spots, four ways over walkable tiles", () => {
    const faults: string[] = [];
    for (const from of spots) {
      for (const to of spots) {
        const path = findTiles(floor, from.tile!, to.tile!);
        const pair = `${from.x},${from.y} → ${to.x},${to.y}`;
        if (!path) {
          faults.push(`${pair}: no way`);
          continue;
        }
        for (let i = 1; i < path.length; i++) {
          const { x, y } = path[i]!;
          const step = Math.abs(x - path[i - 1]!.x) + Math.abs(y - path[i - 1]!.y);
          if (step !== 1) faults.push(`${pair}: a step of ${step} to ${x},${y}`);
          if (i < path.length - 1 && floor.walkable[y * floor.width + x] !== 1)
            faults.push(`${pair}: through ${x},${y}`);
        }
      }
    }
    expect(faults).toEqual([]);
  });

  it("never crosses a desk, a chair or furniture", () => {
    const faults: string[] = [];
    for (const from of spots) {
      for (const to of spots) {
        const route = routeBetween(floor, from, to);
        const pair = `${from.x},${from.y} → ${to.x},${to.y}`;
        if (!route) faults.push(`${pair}: no route`);
        else
          for (const tile of blockedCrossings(floor, route)) faults.push(`${pair}: over ${tile}`);
      }
    }
    expect(faults).toEqual([]);
  });
});

describe("routes", () => {
  const layout = layoutOffice(floorPeopleOf(8));
  const amenities = amenitiesOf(layout);
  const floor = routeFloorOf(layout, amenities);

  it("steps out of the chair and into the next one, merging points in a line", () => {
    const from = layout.desks[0]!;
    const to = layout.desks[1]!;
    const route = routeBetween(floor, deskSpot(from), deskSpot(to))!;
    expect(route[0]).toEqual({ x: from.x + 1.45, y: from.y + 1 });
    expect(route[1]).toEqual({ x: from.x + 2.4, y: from.y + 1 });
    expect(route.at(-2)).toEqual({ x: to.x + 2.4, y: to.y + 1 });
    expect(route.at(-1)).toEqual({ x: to.x + 1.45, y: to.y + 1 });
    for (let i = 2; i < route.length; i++) {
      const [a, b, c] = [route[i - 2]!, route[i - 1]!, route[i]!];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      expect(Math.abs(cross)).toBeGreaterThan(0.0001);
    }
  });

  it("finds no way to a walled-in tile", () => {
    const walled = new Uint8Array(floor.walkable);
    for (const [x, y] of [
      [5, 3],
      [7, 3],
      [6, 2],
      [6, 4],
    ] as const) {
      walled[y * floor.width + x] = 0;
    }
    const closed = { ...floor, walkable: walled };
    expect(findTiles(closed, { x: 0, y: 3 }, { x: 6, y: 3 })).toBeNull();
    expect(
      routeBetween(
        closed,
        { x: 0.5, y: 3.5, tile: { x: 0, y: 3 } },
        { x: 6.5, y: 3.5, tile: { x: 6, y: 3 } },
      ),
    ).toBeNull();
  });
});
