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
import { officePerson, rosterOf } from "./live-view.fixtures.ts";
import type { Desk, Layout } from "./live-view-types.ts";

function groupColumns(layout: Layout): string[] {
  return layout.columns.map((column) => column.group);
}

/** The desks as plain values, to compare before and after a change. */
function deskValues(desks: readonly Desk[]): object[] {
  return desks.map(({ column, ...desk }) => ({ ...desk, columnX: column.x }));
}

describe("the floor plan", () => {
  it.each([
    [3, 12, 9],
    [8, 13, 9],
    [16, 16, 14],
    [30, 19, 18],
  ])("is %i people wide %i and deep %i", (count, width, depth) => {
    const people = count === 3 ? [...rosterOf(2), officePerson("developer")] : rosterOf(count);
    const layout = layoutOffice(people);
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
    for (const seat of [...amenities.meetingSeats, ...amenities.chillSeats]) {
      expect(isWalkable(layout, walkable, seat.tile.x, seat.tile.y)).toBe(true);
    }
  });

  it("gives each beanbag its own colour", () => {
    const amenities = amenitiesOf(layoutOffice(rosterOf(16)));
    const variants = amenities.items
      .filter((item) => item.kind === "beanbag")
      .map((item) => item.variant);
    expect(variants).toEqual([0, 1, 2]);
  });
});
