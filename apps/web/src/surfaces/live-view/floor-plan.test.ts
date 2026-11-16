import { describe, expect, it } from "vitest";
import {
  addHire,
  amenitiesOf,
  deskOf,
  isWalkable,
  layoutOffice,
  letGo,
  walkableOf,
} from "./floor-plan.ts";
import { FLOOR_SIZES, floorPeopleOf, officePerson, rosterOf } from "./live-view.fixtures.ts";
import type { Amenity, Desk, Layout } from "./live-view-types.ts";

function groupColumns(layout: Layout): string[] {
  return layout.columns.map((column) => column.group);
}

/** The desks as plain values, to compare before and after a change. */
function deskValues(desks: readonly Desk[]): object[] {
  return desks.map(({ column, ...desk }) => ({ ...desk, columnX: column.x }));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A piece of furniture as `kind@x,y`, to two decimals. */
function itemAt(item: Amenity): string {
  return `${item.kind}@${round(item.x)},${round(item.y)}`;
}

/** The furniture of each design floor before the exercise mat came, from main's `amenitiesOf`. */
const FURNITURE_BEFORE_THE_MAT: Record<(typeof FLOOR_SIZES)[number], readonly string[]> = {
  3: [
    "meetingTable@1.6,1.2",
    "plant@5.5,0.45",
    "sofa@6,0.08",
    "coffeeMachine@9.05,0.08",
    "waterCooler@10,0.05",
    "coffeeTable@6.7,2.1",
    "beanbag@5.55,2.4",
  ],
  8: [
    "meetingTable@1.6,1.2",
    "plant@5.5,0.45",
    "sofa@6,0.08",
    "coffeeMachine@9.05,0.08",
    "waterCooler@10,0.05",
    "coffeeTable@6.7,2.1",
    "beanbag@5.55,2.4",
    "beanbag@9.5,2.4",
  ],
  30: [
    "meetingTable@1.6,1.2",
    "plant@5.5,0.45",
    "sofa@6,0.08",
    "coffeeMachine@12.05,0.08",
    "waterCooler@13,0.05",
    "coffeeTable@6.7,2.1",
    "beanbag@5.55,2.4",
    "beanbag@12.5,2.4",
    "beanbag@13.5,2.45",
    "bookshelf@14.2,0.05",
    "plant@16.6,0.45",
    "printer@17.4,0.06",
  ],
};
/** How many tiles the furniture blocked on each design floor before the mat came. */
const BLOCKED_BEFORE_THE_MAT: Record<(typeof FLOOR_SIZES)[number], number> = {
  3: 17,
  8: 18,
  30: 31,
};

describe("the floor plan", () => {
  it.each([
    [3, 12, 9],
    [8, 13, 9],
    [16, 16, 14],
    [30, 19, 18],
  ])("is %i people wide %i and deep %i", (count, width, depth) => {
    const layout = layoutOffice(floorPeopleOf(count));
    expect({ width: layout.width, depth: layout.depth }).toEqual({ width, depth });
  });

  it("puts the front desk by the door and the Consultants next to the meeting spot", () => {
    const layout = layoutOffice(rosterOf(8));
    expect(groupColumns(layout)).toEqual(["front-desk", "consultants", "consultants", "team"]);
    expect(deskOf(layout, "office-manager")?.group).toBe("front-desk");
    expect(deskOf(layout, "caretaker")?.group).toBe("front-desk");
    expect(deskOf(layout, "office-manager")?.x).toBe(1);
    expect(deskOf(layout, "cto")).toMatchObject({ group: "consultants", x: 4 });
    expect(deskOf(layout, "developer")).toMatchObject({ group: "team", x: 10 });
  });

  it("gives a hire the desk someone let go left, nobody else's desk moving", () => {
    const layout = layoutOffice(rosterOf(8));
    letGo(layout, "developer");
    const before = deskValues(layout.desks.filter((desk) => desk.roleKey !== null));
    const leftDesk = layout.desks.find((desk) => desk.formerKey === "developer");
    const desk = addHire(layout, officePerson("qa-engineer"));
    expect(desk).toBe(leftDesk);
    expect(desk.formerKey).toBeNull();
    expect(deskValues(layout.desks.filter((other) => other !== desk))).toEqual(before);
  });

  it("opens a new pod at the right end when the group's desks are full, nobody moving", () => {
    const layout = layoutOffice(rosterOf(8));
    const before = deskValues(layout.desks);
    expect(layout.width).toBe(13);
    const desk = addHire(layout, officePerson("qa-engineer"));
    expect(desk).toMatchObject({ group: "team", x: 13, slot: 0 });
    expect(layout.width).toBe(16);
    const next = addHire(layout, officePerson("frontend-developer"));
    expect(next).toMatchObject({ x: 13, slot: 1 });
    expect(deskValues(layout.desks.slice(0, before.length))).toEqual(before);
  });

  it("blocks every tile furniture and desks stand on", () => {
    const layout = layoutOffice(rosterOf(16));
    const amenities = amenitiesOf(layout);
    const walkable = walkableOf(layout, amenities);
    const onTheFloor = amenities.blocked.filter(([x, y]) => x < layout.width && y < layout.depth);
    expect(onTheFloor.length).toBeGreaterThan(0);
    for (const [x, y] of onTheFloor) expect(isWalkable(layout, walkable, x, y)).toBe(false);
    for (const desk of layout.desks) {
      for (const [x, y] of [
        [desk.x, desk.y],
        [desk.x + 1, desk.y],
        [desk.x, desk.y + 1],
        [desk.x + 1, desk.y + 1],
      ] as const) {
        expect(isWalkable(layout, walkable, x, y)).toBe(false);
      }
    }
    // The aisle by the door stays open, and so does every seat's tile.
    expect(isWalkable(layout, walkable, 0, 3)).toBe(true);
    for (const seat of [...amenities.meetingSeats, ...amenities.pastimeSpots]) {
      expect(isWalkable(layout, walkable, seat.tile.x, seat.tile.y)).toBe(true);
    }
  });

  it.each(FLOOR_SIZES)(
    "keeps the %i-person floor's furniture where it was before the exercise mat",
    (count) => {
      const amenities = amenitiesOf(layoutOffice(floorPeopleOf(count)));
      expect(amenities.items.filter((item) => item.kind !== "exerciseMat").map(itemAt)).toEqual(
        FURNITURE_BEFORE_THE_MAT[count],
      );
      expect(amenities.blocked).toHaveLength(BLOCKED_BEFORE_THE_MAT[count]);
    },
  );

  it.each(FLOOR_SIZES)(
    "lays the exercise mat on the %i-person floor flat at 4,1, blocking no tile, a spot on each tile",
    (count) => {
      const layout = layoutOffice(floorPeopleOf(count));
      const amenities = amenitiesOf(layout);
      const walkable = walkableOf(layout, amenities);
      expect(amenities.items.filter((item) => item.kind === "exerciseMat")).toEqual([
        { kind: "exerciseMat", x: 4, y: 1, depth: 0 },
      ]);
      for (const [x, y] of [
        [4, 1],
        [4, 2],
      ] as const) {
        expect(amenities.blocked).not.toContainEqual([x, y]);
        expect(isWalkable(layout, walkable, x, y)).toBe(true);
      }
      expect(
        amenities.pastimeSpots
          .filter((spot) => spot.kind === "exercise")
          .map((spot) => ({ x: spot.x, y: spot.y, tile: spot.tile })),
      ).toEqual([
        { x: 4.5, y: 1.5, tile: { x: 4, y: 1 } },
        { x: 4.5, y: 2.5, tile: { x: 4, y: 2 } },
      ]);
    },
  );

  it.each(FLOOR_SIZES)(
    "gives every pastime on the %i-person floor its spots, none of them shared",
    (count) => {
      const layout = layoutOffice(floorPeopleOf(count));
      const amenities = amenitiesOf(layout);
      const spotsOf = (kind: string) => amenities.pastimeSpots.filter((spot) => spot.kind === kind);
      const itemsOf = (kind: string) => amenities.items.filter((item) => item.kind === kind);
      expect(spotsOf("sofa")).toHaveLength(layout.sofaSeats);
      expect(spotsOf("beanbag")).toHaveLength(layout.beanbags);
      expect(spotsOf("coffee")).toHaveLength(1);
      expect(spotsOf("water")).toHaveLength(1);
      expect(spotsOf("exercise")).toHaveLength(2);
      // One in front of each plant, the chill area's included, and each bookshelf.
      expect(spotsOf("plant")).toHaveLength(itemsOf("plant").length);
      expect(spotsOf("bookshelf")).toHaveLength(itemsOf("bookshelf").length);
      for (const spot of [...spotsOf("plant"), ...spotsOf("bookshelf")]) {
        expect(spot).toMatchObject({ facing: "back", y: 1.25, tile: { y: 1 } });
      }
      // The chill area's plant comes first, at its plant.
      expect(spotsOf("plant")[0]).toMatchObject({ x: layout.chillStart + 0.5 });
      const places = amenities.pastimeSpots.map((spot) => `${spot.x},${spot.y}`);
      expect(new Set(places).size).toBe(places.length);
    },
  );

  it("gives each beanbag its own colour", () => {
    const amenities = amenitiesOf(layoutOffice(rosterOf(16)));
    const variants = amenities.items
      .filter((item) => item.kind === "beanbag")
      .map((item) => item.variant);
    expect(variants).toEqual([0, 1, 2]);
  });
});
