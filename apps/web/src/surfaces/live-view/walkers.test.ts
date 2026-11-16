import type { LiveConsulting } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  addHire,
  amenitiesOf,
  consultSpot,
  deskOf,
  deskSpot,
  layoutOffice,
  letGo,
} from "./floor-plan.ts";
import { lightAt } from "./light.ts";
import { placementsOf } from "./live-states.ts";
import { floorPeopleOf, officePerson, rosterOf } from "./live-view.fixtures.ts";
import type { FloorPoint, Light, OfficePerson, Placement } from "./live-view-types.ts";
import { blockedCrossings } from "./routes.fixtures.ts";
import { routeBetween, routeFloorOf, routeLength } from "./routes.ts";
import { OUTSIDE, WALK_SPEED, type Walker, createWalkers } from "./walkers.ts";

const NOW = new Date(2026, 10, 15, 13, 5);
const DAY = lightAt(NOW);
const NIGHT: Light = { phase: "night", tint: 0x404080, lampsOn: true };
const FRAME = 1 / 60;

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function working(roleKey: string): OfficePerson {
  return officePerson(roleKey, { state: "working" });
}

function asking(consultantRoleKey: string): LiveConsulting {
  return {
    decisionId: "00000000-0000-4000-8000-0000000000d1",
    threadId: "00000000-0000-4000-8000-000000000002",
    home: { kind: "task", taskId: "task-1" },
    consultantRoleKey,
    question: "Which way?",
    since: minutesAgo(2),
  };
}

function consulting(roleKey: string, consultantRoleKey: string): OfficePerson {
  return officePerson(roleKey, { state: "consulting", consulting: [asking(consultantRoleKey)] });
}

function idleFor(roleKey: string, minutes: number): OfficePerson {
  return officePerson(roleKey, { idleSince: minutesAgo(minutes) });
}

/** Everyone of the eight working, but those swapped in by Role key. */
function eightWith(...people: OfficePerson[]): OfficePerson[] {
  return rosterOf(8).map(
    (person) => people.find((other) => other.roleKey === person.roleKey) ?? working(person.roleKey),
  );
}

/** An office opened on `people`, its walkers, and what happened to them. */
function office(people: readonly OfficePerson[]) {
  const layout = layoutOffice(people);
  let amenities = amenitiesOf(layout);
  const events: { kind: "arrive" | "depart" | "gone"; key: string; at: number }[] = [];
  const walkers = createWalkers(routeFloorOf(layout, amenities), {
    onArrive: (walker) => events.push({ kind: "arrive", key: walker.key, at: walkers.time() }),
    onDepart: (walker) => events.push({ kind: "depart", key: walker.key, at: walkers.time() }),
    onGone: (walker) => events.push({ kind: "gone", key: walker.key, at: walkers.time() }),
  });
  let known = new Set(people.map((person) => person.roleKey));
  const placementsFor = (now: readonly OfficePerson[], light = DAY) =>
    placementsOf(now, layout, amenities, light, NOW);
  const apply = (now: readonly OfficePerson[], { light = DAY, animate = true } = {}) => {
    const keys = new Set(now.map((person) => person.roleKey));
    let hired = false;
    for (const person of now) {
      if (known.has(person.roleKey)) continue;
      addHire(layout, person);
      hired = true;
    }
    for (const key of known) if (!keys.has(key)) letGo(layout, key);
    known = keys;
    if (hired) {
      amenities = amenitiesOf(layout);
      walkers.setFloor(routeFloorOf(layout, amenities));
    }
    walkers.direct(now, placementsFor(now, light), { animate });
  };
  apply(people);
  return {
    layout,
    walkers,
    events,
    apply,
    placementsFor,
    floor: () => routeFloorOf(layout, amenities),
    amenities: () => amenities,
    walker: (key: string): Walker => walkers.get(key)!,
    /** Steps frame by frame for `seconds`, or until `done` holds. */
    run(seconds: number, done: () => boolean = () => false): number {
      let elapsed = 0;
      while (elapsed < seconds - 1e-9 && !done()) {
        walkers.step(FRAME);
        elapsed += FRAME;
      }
      return elapsed;
    },
  };
}

const settled = (walker: Walker | undefined): boolean =>
  walker !== undefined && walker.target === null;

function pointOf(point: FloorPoint): FloorPoint {
  return { x: point.x, y: point.y };
}

function spotOf(placement: Placement | undefined): FloorPoint {
  return pointOf(placement!.spot);
}

describe("walkers", () => {
  it("puts everyone in place at once the first time", () => {
    const people = eightWith(idleFor("developer", 5));
    const world = office(people);
    const placements = world.placementsFor(people);
    for (const walker of world.walkers.walkers()) {
      expect(walker.target).toBeNull();
      expect({ x: walker.x, y: walker.y }).toEqual(spotOf(placements.get(walker.key)));
    }
    expect(world.walkers.sparkles()).toEqual([]);
  });

  it("walks a route at 2.4 tiles a second, to within a frame", () => {
    const world = office(eightWith(idleFor("developer", 5)));
    const from = world.walker("developer").placement.spot;
    world.apply(eightWith());
    const to = deskSpot(deskOf(world.layout, "developer")!);
    const length = routeLength(routeBetween(world.floor(), from, to)!);
    const took = world.run(30, () => settled(world.walker("developer")));
    expect(Math.abs(took - length / WALK_SPEED)).toBeLessThanOrEqual(FRAME + 1e-9);
    expect({ x: world.walker("developer").x, y: world.walker("developer").y }).toEqual({
      x: to.x,
      y: to.y,
    });
  });

  it("walks an asker to the Consultant's desk, turns the Consultant round once there, and back", () => {
    const world = office(eightWith());
    world.apply(eightWith(consulting("developer", "cto")));
    const asker = world.walker("developer");
    expect(asker.target?.kind).toBe("consult");
    expect(world.walkers.visitorsOf("cto")).toEqual([]);
    expect(world.walkers.conversations().size).toBe(0);
    world.run(30, () => settled(asker));
    expect({ x: asker.x, y: asker.y }).toEqual(pointOf(consultSpot(deskOf(world.layout, "cto")!)));
    expect(world.walkers.visitorsOf("cto")).toEqual([asker]);
    expect(world.walkers.conversations().get("cto")).toEqual(["cto", "developer"]);
    world.apply(eightWith());
    expect(world.walkers.visitorsOf("cto")).toEqual([]);
    world.run(30, () => settled(asker));
    expect(asker.placement.kind).toBe("desk");
    expect({ x: asker.x, y: asker.y }).toEqual(
      pointOf(deskSpot(deskOf(world.layout, "developer")!)),
    );
  });

  it("walks two askers and their Consultant to the meeting spot, and back", () => {
    const world = office(eightWith());
    const asked = eightWith(consulting("developer", "cto"), consulting("reviewer", "cto"));
    world.apply(asked);
    const seats = world.amenities().meetingSeats;
    world.run(30, () =>
      ["cto", "developer", "reviewer"].every((key) => settled(world.walker(key))),
    );
    expect(
      ["cto", "developer", "reviewer"].map((key) => spotOf(world.walker(key).placement)),
    ).toEqual([seats[0], seats[1], seats[2]].map((seat) => ({ x: seat!.x, y: seat!.y })));
    expect(world.walkers.conversations().get("reviewer")).toEqual(["cto", "developer", "reviewer"]);
    world.apply(eightWith());
    world.run(30, () =>
      ["cto", "developer", "reviewer"].every((key) => settled(world.walker(key))),
    );
    for (const key of ["cto", "developer", "reviewer"])
      expect(world.walker(key).placement.kind).toBe("desk");
  });

  it("walks someone idle to a chill seat, and back to the desk once asleep", () => {
    const world = office(eightWith());
    world.apply(eightWith(idleFor("developer", 5)));
    const walker = world.walker("developer");
    world.run(30, () => settled(walker));
    expect(walker.placement.kind).toBe("chill");
    world.apply(eightWith(idleFor("developer", 45)));
    expect(walker.target?.kind).toBe("desk");
    world.run(30, () => settled(walker));
    expect(walker.placement).toMatchObject({ kind: "desk", activity: "asleep" });
  });

  it("walks a hire in from outside to a sparkling desk", () => {
    const world = office(eightWith());
    const hire = working("qa-engineer");
    world.apply([...eightWith(), hire]);
    const walker = world.walker("qa-engineer");
    expect(walker).toMatchObject({ hidden: true, x: OUTSIDE.spot.x, y: OUTSIDE.spot.y });
    expect(world.walkers.sparkles()).toEqual([{ roleKey: "qa-engineer", until: 3 }]);
    world.run(0.25);
    expect(walker.hidden).toBe(true);
    world.run(0.1);
    expect(walker.hidden).toBe(false);
    expect(world.walkers.doorOpen()).toBe(true);
    world.run(30, () => settled(walker));
    expect(walker.placement.kind).toBe("desk");
    expect({ x: walker.x, y: walker.y }).toEqual(
      pointOf(deskSpot(deskOf(world.layout, "qa-engineer")!)),
    );
    expect(world.walkers.doorOpen()).toBe(false);
    expect(world.walkers.sparkles()).toEqual([]);
  });

  it("walks someone let go out of the door and removes them", () => {
    const world = office(eightWith());
    world.apply(eightWith().filter((person) => person.roleKey !== "developer"));
    const walker = world.walker("developer");
    expect(walker).toMatchObject({ leaving: true, person: { roleKey: "developer" } });
    expect(walker.target?.kind).toBe("gone");
    world.run(30, () => world.walkers.get("developer") === undefined);
    expect(world.walkers.get("developer")).toBeUndefined();
    expect(world.events.filter((event) => event.kind === "gone").map((event) => event.key)).toEqual(
      ["developer"],
    );
  });

  it("keeps someone let go mid-walk on the move while they wait their turn at the door", () => {
    const world = office(eightWith());
    world.apply(eightWith(idleFor("developer", 5)));
    const walker = world.walker("developer");
    const desk = walker.placement;
    world.run(1);
    const stoppedAt = { x: walker.x, y: walker.y };
    world.apply(eightWith().filter((person) => person.roleKey !== "developer"));
    expect(walker.delay).toBeGreaterThan(0);
    expect(world.walkers.isWalking(walker)).toBe(false);
    // Waiting mid-way, it is drawn in the walk cycle at its feet, not seated at the desk it left.
    expect(world.walkers.isOnTheMove(walker)).toBe(true);
    expect(world.walkers.depthOf(walker)).not.toBe(desk.depth);
    world.run(0.25);
    expect({ x: walker.x, y: walker.y }).toEqual(stoppedAt);
    world.run(30, () => world.walkers.get("developer") === undefined);
    expect(world.walkers.get("developer")).toBeUndefined();
  });

  it("walks four people out one by one in hire order at nightfall, and back in at dawn", () => {
    const sleepers = ["office-manager", "caretaker", "cto", "devops"];
    const people = eightWith(...sleepers.map((key) => idleFor(key, 45)));
    const world = office(people);
    world.apply(people, { light: NIGHT });
    world.run(30, () => sleepers.every((key) => settled(world.walker(key))));
    const departures = world.events.filter((event) => event.kind === "depart");
    expect(departures.map((event) => event.key)).toEqual(sleepers);
    departures.forEach((event, n) => expect(event.at).toBeCloseTo(0.3 + 1.1 * n, 1));
    for (const key of sleepers)
      expect(world.walker(key)).toMatchObject({ hidden: true, placement: { kind: "gone" } });
    expect(world.walker("developer").hidden).toBe(false);

    world.events.length = 0;
    const dawn = world.walkers.time();
    world.apply(people);
    expect(world.walker("office-manager").hidden).toBe(true);
    world.run(30, () => sleepers.every((key) => settled(world.walker(key))));
    const returns = world.events.filter((event) => event.kind === "depart");
    expect(returns.map((event) => event.key)).toEqual(sleepers);
    returns.forEach((event, n) => expect(event.at - dawn).toBeCloseTo(0.3 + 1.1 * n, 1));
    for (const key of sleepers)
      expect(world.walker(key)).toMatchObject({ hidden: false, placement: { kind: "desk" } });
  });

  it.each([0.1, 0.25, 0.6, 1.2, 2.5])(
    "turns a figure %ss into its walk towards its new place, never through furniture",
    (seconds) => {
      const world = office(eightWith());
      world.apply(eightWith(idleFor("developer", 5)));
      world.run(seconds);
      const walker = world.walker("developer");
      expect(walker.target).not.toBeNull();
      const at = { x: walker.x, y: walker.y };
      const walked = walker.walked;
      world.apply(eightWith(consulting("developer", "cto")));
      expect(walker.route![0]).toEqual(at);
      expect(walker.walked).toBe(walked);
      expect(walker.target?.kind).toBe("consult");
      // Its first step may leave the tile it stands on, a chair's included; nothing after that is blocked.
      expect(blockedCrossings(world.floor(), walker.route!)).toEqual([]);
      world.run(30, () => settled(walker));
      expect(walker.placement.kind).toBe("consult");
    },
  );

  it("keeps the walk on when the same place comes again mid-walk", () => {
    const world = office(eightWith());
    world.apply(eightWith(idleFor("developer", 5)));
    world.run(0.5);
    const walker = world.walker("developer");
    const route = walker.route;
    world.apply(eightWith(idleFor("developer", 6)));
    expect(walker.route).toBe(route);
    expect(walker.target?.kind).toBe("chill");
  });

  it("jumps without animation, ends every walk on settle, and routes again on a new floor", () => {
    const world = office(eightWith());
    world.apply(eightWith(idleFor("developer", 5)), { animate: false });
    expect(world.walker("developer")).toMatchObject({ target: null, placement: { kind: "chill" } });

    world.apply(eightWith(consulting("developer", "cto"), idleFor("reviewer", 5)));
    world.apply(eightWith(consulting("developer", "cto"), idleFor("reviewer", 5)).slice(1));
    world.run(0.2);
    world.walkers.settle();
    expect([...world.walkers.walkers()].every((walker) => walker.target === null)).toBe(true);
    expect(world.walkers.get("office-manager")).toBeUndefined();
    expect(world.walker("developer").placement.kind).toBe("consult");

    world.apply(eightWith().slice(1));
    world.run(0.3);
    const before = world.walker("developer").route;
    const hires = ["hire-a", "hire-b", "hire-c", "hire-d"].map(working);
    world.apply([...eightWith().slice(1), ...hires]);
    const after = world.walker("developer").route;
    expect(after).not.toBe(before);
    expect(blockedCrossings(world.floor(), after!)).toEqual([]);
  });

  it("keeps a seat's depth until a step away", () => {
    const world = office(eightWith());
    const desk = deskOf(world.layout, "developer")!;
    world.apply(eightWith(idleFor("developer", 5)));
    const walker = world.walker("developer");
    const spot = deskSpot(desk);
    const nearSeat: number[] = [];
    world.run(5, () => {
      if (Math.hypot(walker.x - spot.x, walker.y - spot.y) >= 1) return true;
      nearSeat.push(world.walkers.depthOf(walker));
      return false;
    });
    expect(nearSeat.length).toBeGreaterThan(3);
    expect(Math.min(...nearSeat)).toBeGreaterThanOrEqual(desk.depth + 0.1);
    // A step away, the feet decide.
    expect(world.walkers.depthOf(walker)).toBeCloseTo(walker.x + walker.y, 6);
  });

  it.each([
    [1, 0, "walk-front", false],
    [-1, 0, "walk-back", false],
    [0, 1, "walk-front", true],
    [0, -1, "walk-back", true],
  ] as const)(
    "faces the way it goes: heading %i,%i is %s, mirrored %s",
    (dx, dy, pose, mirrored) => {
      const world = office(floorPeopleOf(3));
      const walker = world.walker("developer");
      walker.heading.dx = dx;
      walker.heading.dy = dy;
      walker.walked = 0.65;
      expect(world.walkers.poseOf(walker)).toEqual({ pose, frame: 3, mirrored });
      walker.walked = 0.85;
      expect(world.walkers.poseOf(walker).frame).toBe(0);
    },
  );
});
