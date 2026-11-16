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

/** The entertainment area's TV stand and its three floor pillows, the middle one first. */
const ENTERTAINMENT_AREA = [
  "tvStand@1.4,0",
  "floorPillow@2.5,1.5",
  "floorPillow@1.5,1.5",
  "floorPillow@3.5,1.5",
] as const;

/**
 * The furniture of each design floor before the exercise mat came, from main's `amenitiesOf`, with
 * the entertainment area where the meeting spot was.
 */
const FURNITURE_BEFORE_THE_MAT: Record<(typeof FLOOR_SIZES)[number], readonly string[]> = {
  3: [
    ...ENTERTAINMENT_AREA,
    "plant@5.5,0.45",
    "sofa@6,0.08",
    "coffeeMachine@9.05,0.08",
    "waterCooler@10,0.05",
    "coffeeTable@6.7,2.1",
    "beanbag@5.55,2.4",
  ],
  8: [
    ...ENTERTAINMENT_AREA,
    "plant@5.5,0.45",
    "sofa@6,0.08",
    "coffeeMachine@9.05,0.08",
    "waterCooler@10,0.05",
    "coffeeTable@6.7,2.1",
    "beanbag@5.55,2.4",
    "beanbag@9.5,2.4",
  ],
  30: [
    ...ENTERTAINMENT_AREA,
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
/**
 * How many tiles the furniture blocked on each design floor before the mat came, less one: the
 * meeting spot blocked seven, the entertainment area blocks six.
 */
const BLOCKED_BEFORE_THE_MAT: Record<(typeof FLOOR_SIZES)[number], number> = {
  3: 16,
  8: 17,
  30: 30,
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

  it("puts the front desk by the door and the Consultants next to the entertainment area", () => {
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
    for (const seat of amenities.pastimeSpots) {
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
      // The front tile first: on the back one a beanbag stands in front of a push-up.
      expect(
        amenities.pastimeSpots
          .filter((spot) => spot.kind === "exercise")
          .map((spot) => ({ x: spot.x, y: spot.y, tile: spot.tile })),
      ).toEqual([
        { x: 4.5, y: 2.5, tile: { x: 4, y: 2 } },
        { x: 4.5, y: 1.5, tile: { x: 4, y: 1 } },
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
      expect(spotsOf("games")).toHaveLength(3);
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

  it("puts three floor pillows facing the TV where the meeting spot was, a games seat on each", () => {
    const layout = layoutOffice(rosterOf(8));
    const amenities = amenitiesOf(layout);
    const walkable = walkableOf(layout, amenities);
    expect(amenities.items.filter((item) => item.kind === "tvStand").map(itemAt)).toEqual([
      "tvStand@1.4,0",
    ]);
    expect(amenities.items.filter((item) => item.kind === "floorPillow")).toHaveLength(3);
    const games = amenities.pastimeSpots.filter((spot) => spot.kind === "games");
    expect(games.map((seat) => [seat.x, seat.y, seat.tile.x, seat.tile.y])).toEqual([
      [2.5, 1.5, 2, 2],
      [1.5, 1.5, 1, 2],
      [3.5, 1.5, 3, 2],
    ]);
    const tvStand = amenities.items.find((item) => item.kind === "tvStand");
    for (const seat of games) {
      // The back view looks along -x, mirrored along -y: at the TV, against the back wall (y 0)
      // in front of every pillow.
      expect(seat).toMatchObject({ facing: "back", mirrored: true, seatZ: -1 });
      expect(tvStand).toMatchObject({ y: 0 });
      expect(seat.y).toBeGreaterThan(0);
      expect(seat.x).toBeGreaterThanOrEqual(tvStand?.x ?? Infinity);
      expect(seat.x).toBeLessThanOrEqual((tvStand?.x ?? -Infinity) + 2.2);
      // The pillow blocks its own tile; it is reached from the one behind it.
      expect(isWalkable(layout, walkable, Math.floor(seat.x), Math.floor(seat.y))).toBe(false);
      expect(isWalkable(layout, walkable, seat.tile.x, seat.tile.y)).toBe(true);
    }
    // The TV stand blocks the row along the wall.
    for (const x of [1, 2, 3]) expect(isWalkable(layout, walkable, x, 0)).toBe(false);
    expect(amenities.items.some((item) => (item.kind as string) === "meetingTable")).toBe(false);
  });

  it("gives each floor pillow its own colour", () => {
    const amenities = amenitiesOf(layoutOffice(rosterOf(8)));
    const variants = amenities.items
      .filter((item) => item.kind === "floorPillow")
      .map((item) => item.variant)
      .toSorted();
    expect(variants).toEqual([0, 1, 2]);
  });

  it("gives each beanbag its own colour", () => {
    const amenities = amenitiesOf(layoutOffice(rosterOf(16)));
    const variants = amenities.items
      .filter((item) => item.kind === "beanbag")
      .map((item) => item.variant);
    expect(variants).toEqual([0, 1, 2]);
  });
});
