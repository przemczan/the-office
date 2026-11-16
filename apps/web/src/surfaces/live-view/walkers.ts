import { AISLE_ROW, DOOR_OUTSIDE } from "./floor-plan.ts";
import type { FloorPoint, OfficePerson, Placement, Spot } from "./live-view-types.ts";
import { type RouteFloor, routeBetween } from "./routes.ts";

/** Tiles a second (design decision 12). */
export const WALK_SPEED = 2.4;
/** The longest step a walk takes in one frame, so a stalled frame doesn't jump a figure through a wall. */
const MAX_STEP_SECONDS = 0.05;
/** How long a new desk sparkles. */
const SPARKLE_SECONDS = 3;
/** Moves through the door in one snapshot go one by one: the first after this, then each this much later. */
const DOOR_FIRST_DELAY = 0.3;
const DOOR_DELAY_STEP = 1.1;

/** Outside, past the door: where a hire comes from and someone let go or gone home goes to. */
export const OUTSIDE: Placement = {
  kind: "gone",
  spot: DOOR_OUTSIDE,
  pose: "stand-front",
  facing: "front",
  mirrored: false,
  z: 0,
  depth: DOOR_OUTSIDE.x + DOOR_OUTSIDE.y,
  activity: null,
  consultantKey: null,
  conversation: null,
};

/** The walk cycle's pose: facing the way the figure goes, mirrored when it goes along y. */
export interface WalkPose {
  pose: "walk-front" | "walk-back";
  frame: number;
  mirrored: boolean;
}

/** A figure on the floor, where it stands and where it walks to. */
export interface Walker {
  readonly key: string;
  /** The person as last seen; kept for drawing someone let go on their way out. */
  person: OfficePerson;
  x: number;
  y: number;
  /** Where the figure is, or the place it left while it walks. */
  placement: Placement;
  /** Where it walks to; null once there. */
  target: Placement | null;
  route: FloorPoint[] | null;
  /** The route point it walks towards. */
  routeIndex: number;
  /** Tiles walked, which drives the stride. */
  walked: number;
  /** Seconds before it sets off, in its current pose. */
  delay: number;
  /** Outside the room, not drawn. */
  hidden: boolean;
  /** Let go: walks out and is removed. */
  leaving: boolean;
  readonly heading: { dx: number; dy: number };
  readonly walk: WalkPose;
}

/** A new desk's sparkle, until the walkers' clock reaches `until`. */
export interface Sparkle {
  readonly roleKey: string;
  readonly until: number;
}

export interface WalkerEvents {
  /** A walk ended at a place on the floor, or hidden outside. */
  readonly onArrive?: (walker: Walker) => void;
  /** A walk that waited its turn set off. */
  readonly onDepart?: (walker: Walker) => void;
  /** Someone let go is out of the door and removed. */
  readonly onGone?: (walker: Walker) => void;
}

export interface Walkers {
  /**
   * Sends everyone where their placement says: the first time, and whenever `animate` is false, by a
   * jump; otherwise walking there. Moves through the door go one by one in hire order.
   */
  direct(
    people: readonly OfficePerson[],
    placements: ReadonlyMap<string, Placement>,
    options: { readonly animate: boolean },
  ): void;
  /** Moves every walk on by `dt` seconds; answers the walkers that moved, in an array reused each step. */
  step(dt: number): readonly Walker[];
  /** Ends every walk at once, at its target; those let go are removed. */
  settle(): void;
  /** After a hire changed the floor: walks in flight are routed again from where they stand. */
  setFloor(floor: RouteFloor): void;
  walkers(): MapIterator<Walker>;
  get(key: string): Walker | undefined;
  isWalking(walker: Walker): boolean;
  /**
   * Walking, or stopped mid-way waiting its turn through the door: drawn in the walk cycle, not in
   * the pose of the place it left.
   */
  isOnTheMove(walker: Walker): boolean;
  /** At its place, not walking nor waiting to. */
  isSettled(walker: Walker): boolean;
  /** The walk cycle's pose, written into `walker.walk`. */
  poseOf(walker: Walker): WalkPose;
  depthOf(walker: Walker): number;
  doorOpen(): boolean;
  /** Those who came to a Consultant's desk and stand there asking. */
  visitorsOf(consultantKey: string): Walker[];
  /** Who talks with whom, in turn order, counting only those settled at their place. */
  conversations(): ReadonlyMap<string, readonly string[]>;
  sparkles(): readonly Sparkle[];
  /** The walkers' clock, in seconds of steps taken. */
  time(): number;
}

/** A placement's identity: its kind and its spot. A new placement with the same key moves nobody. */
export function placementKey(placement: Placement): string {
  return `${placement.kind}:${placement.spot.x},${placement.spot.y}`;
}

/** The depth a figure keeps while it sits at a place, or null when its feet decide. */
function seatedDepth(placement: Placement): number | null {
  return placement.pose.startsWith("sit") ? placement.depth : null;
}

/** A seat's depth while the walker is within a step of it, else -Infinity. */
function seatDepthNear(walker: Walker, place: Placement): number {
  const seated = seatedDepth(place);
  if (seated === null) return -Infinity;
  return Math.hypot(walker.x - place.spot.x, walker.y - place.spot.y) < 1 ? seated : -Infinity;
}

/** A walker standing at `placement`, hidden when that is outside. */
function newWalker(person: OfficePerson, placement: Placement): Walker {
  return {
    key: person.roleKey,
    person,
    x: placement.spot.x,
    y: placement.spot.y,
    placement,
    target: null,
    route: null,
    routeIndex: 0,
    walked: 0,
    delay: 0,
    hidden: placement.kind === "gone",
    leaving: false,
    heading: { dx: -1, dy: 0 },
    walk: { pose: "walk-back", frame: 0, mirrored: false },
  };
}

export function createWalkers(initialFloor: RouteFloor, events: WalkerEvents = {}): Walkers {
  let floor = initialFloor;
  let directed = false;
  let clock = 0;
  let sparkles: Sparkle[] = [];
  const byKey = new Map<string, Walker>();
  const moved: Walker[] = [];

  const isWalking = (walker: Walker): boolean => walker.route !== null && walker.delay <= 0;
  const isAtPlace = (walker: Walker): boolean =>
    walker.x === walker.placement.spot.x && walker.y === walker.placement.spot.y;
  const isOnTheMove = (walker: Walker): boolean =>
    walker.route !== null && (walker.delay <= 0 || !isAtPlace(walker));
  const isSettled = (walker: Walker): boolean => walker.target === null;
  /** On the floor at their place: what talks and turns chairs round. */
  const isPresent = (walker: Walker): boolean =>
    isSettled(walker) && !walker.hidden && !walker.leaving;

  const isWalkableTile = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < floor.width &&
    y < floor.depth &&
    floor.walkable[y * floor.width + x] === 1;

  function snap(walker: Walker, placement: Placement): void {
    walker.placement = placement;
    walker.target = null;
    walker.route = null;
    walker.delay = 0;
    walker.x = placement.spot.x;
    walker.y = placement.spot.y;
    walker.hidden = placement.kind === "gone";
  }

  /**
   * The tile a walk sets off from mid-way: the one underfoot when walkable, else the next route
   * point's, else the last one's. Halfway out of a chair the figure stands on the desk's tile, and
   * routing from there would cross the desk.
   */
  function startTileOf(walker: Walker): FloorPoint {
    const underX = Math.floor(walker.x);
    const underY = Math.floor(walker.y);
    if (isWalkableTile(underX, underY)) return { x: underX, y: underY };
    const route = walker.route;
    if (route) {
      for (const point of [route[walker.routeIndex], route[walker.routeIndex - 1]]) {
        if (!point) continue;
        const x = Math.floor(point.x);
        const y = Math.floor(point.y);
        if (isWalkableTile(x, y)) return { x, y };
      }
    }
    return {
      x: Math.min(Math.max(underX, 0), floor.width - 1),
      y: Math.min(Math.max(underY, 0), floor.depth - 1),
    };
  }

  /** Where a walk starts: outside, the place it stands at (with its step out), or mid-way. */
  function startSpotOf(walker: Walker): Spot {
    if (walker.hidden) return DOOR_OUTSIDE;
    const spot = walker.placement.spot;
    if (walker.x === spot.x && walker.y === spot.y) return spot;
    return { x: walker.x, y: walker.y, tile: startTileOf(walker) };
  }

  function remove(walker: Walker): void {
    byKey.delete(walker.key);
  }

  function move(walker: Walker, placement: Placement, animate: boolean, delay: number): void {
    const route = animate ? routeBetween(floor, startSpotOf(walker), placement.spot) : null;
    // Without a route (never on a laid-out floor) the figure jumps rather than cross furniture.
    if (!route || route.length < 2) {
      snap(walker, placement);
      if (walker.leaving && placement.kind === "gone") remove(walker);
      return;
    }
    if (walker.hidden) {
      walker.x = DOOR_OUTSIDE.x;
      walker.y = DOOR_OUTSIDE.y;
    }
    walker.route = route;
    walker.routeIndex = 1;
    walker.target = placement;
    walker.delay = delay;
  }

  function arrive(walker: Walker, target: Placement): void {
    walker.route = null;
    walker.placement = target;
    walker.target = null;
    if (target.kind === "gone") walker.hidden = true;
    if (walker.leaving && target.kind === "gone") {
      remove(walker);
      events.onGone?.(walker);
      return;
    }
    events.onArrive?.(walker);
  }

  function walkOn(walker: Walker, seconds: number): void {
    let budget = WALK_SPEED * seconds;
    while (budget > 0 && walker.route && walker.target) {
      const next = walker.route[walker.routeIndex]!;
      const dx = next.x - walker.x;
      const dy = next.y - walker.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0.0001) {
        walker.heading.dx = dx;
        walker.heading.dy = dy;
      }
      if (distance <= budget) {
        walker.x = next.x;
        walker.y = next.y;
        walker.walked += distance;
        budget -= distance;
        walker.routeIndex++;
        if (walker.routeIndex >= walker.route.length) arrive(walker, walker.target);
      } else {
        walker.x += (dx / distance) * budget;
        walker.y += (dy / distance) * budget;
        walker.walked += budget;
        budget = 0;
      }
    }
  }

  return {
    direct(people, placements, { animate }) {
      const motion = animate && directed;
      directed = true;
      const present = new Map(people.map((person) => [person.roleKey, person]));
      for (const person of people) {
        const placement = placements.get(person.roleKey);
        if (byKey.has(person.roleKey) || !placement) continue;
        // Someone just hired waits outside and walks in; everyone else is simply where they are.
        byKey.set(person.roleKey, newWalker(person, motion ? OUTSIDE : placement));
        if (motion) sparkles.push({ roleKey: person.roleKey, until: clock + SPARKLE_SECONDS });
      }
      let doorMoves = 0;
      const doorDelay = (): number => DOOR_FIRST_DELAY + DOOR_DELAY_STEP * doorMoves++;
      for (const walker of byKey.values()) {
        const person = present.get(walker.key);
        if (!person) {
          if (walker.leaving) continue;
          walker.leaving = true;
          if (walker.target?.kind === "gone") continue;
          if (walker.hidden && isSettled(walker)) {
            remove(walker);
            continue;
          }
          move(walker, OUTSIDE, motion, motion ? doorDelay() : 0);
          continue;
        }
        walker.person = person;
        walker.leaving = false;
        const wanted = placements.get(walker.key);
        if (!wanted) continue;
        const current = walker.target ?? walker.placement;
        if (placementKey(current) === placementKey(wanted)) {
          if (walker.target) walker.target = wanted;
          else walker.placement = wanted;
          continue;
        }
        const throughDoor = wanted.kind === "gone" || walker.hidden;
        move(walker, wanted, motion, motion && throughDoor ? doorDelay() : 0);
      }
    },

    step(dt) {
      const seconds = Math.min(Math.max(dt, 0), MAX_STEP_SECONDS);
      clock += seconds;
      moved.length = 0;
      for (const walker of byKey.values()) {
        if (!walker.route) continue;
        if (walker.delay > 0) {
          walker.delay -= seconds;
          if (walker.delay > 0) continue;
          walker.delay = 0;
          walker.hidden = false;
          moved.push(walker);
          events.onDepart?.(walker);
          continue;
        }
        walker.hidden = false;
        walkOn(walker, seconds);
        moved.push(walker);
      }
      return moved;
    },

    settle() {
      for (const walker of byKey.values()) {
        if (!walker.target) continue;
        const target = walker.target;
        snap(walker, target);
        if (walker.leaving && target.kind === "gone") remove(walker);
      }
    },

    setFloor(next) {
      floor = next;
      for (const walker of byKey.values()) {
        if (walker.target) move(walker, walker.target, true, walker.delay);
      }
    },

    walkers: () => byKey.values(),
    get: (key) => byKey.get(key),
    isWalking,
    isOnTheMove,
    isSettled,

    poseOf(walker) {
      const { dx, dy } = walker.heading;
      const alongX = Math.abs(dx) >= Math.abs(dy);
      const front = alongX ? dx > 0 : dy > 0;
      walker.walk.pose = front ? "walk-front" : "walk-back";
      walker.walk.frame = Math.floor(walker.walked * 5) % 4;
      walker.walk.mirrored = !alongX;
      return walker.walk;
    },

    depthOf(walker) {
      if (!isOnTheMove(walker)) return walker.placement.depth;
      // Getting up from a seat or sitting down in one, a figure keeps the seat's depth until it is a
      // step away, so the chair or the sofa never covers it mid-move.
      const atFeet = walker.x + walker.y;
      return Math.max(
        atFeet,
        seatDepthNear(walker, walker.placement),
        walker.target ? seatDepthNear(walker, walker.target) : atFeet,
      );
    },

    doorOpen() {
      for (const walker of byKey.values()) {
        if (!walker.hidden && walker.x < 1.4 && Math.abs(walker.y - (AISLE_ROW + 0.5)) < 1.2)
          return true;
      }
      return false;
    },

    visitorsOf(consultantKey) {
      return [...byKey.values()].filter(
        (walker) =>
          isPresent(walker) &&
          walker.placement.kind === "consult" &&
          walker.placement.consultantKey === consultantKey,
      );
    },

    conversations() {
      const talks = new Map<string, readonly string[]>();
      for (const walker of byKey.values()) {
        const talk = walker.placement.conversation;
        if (!talk || talks.has(walker.key) || !isPresent(walker)) continue;
        const group = talk.filter((key) => {
          const other = byKey.get(key);
          return other !== undefined && isPresent(other) && other.placement.conversation === talk;
        });
        if (group.length < 2) continue;
        for (const key of group) talks.set(key, group);
      }
      return talks;
    },

    sparkles() {
      sparkles = sparkles.filter((sparkle) => sparkle.until > clock);
      return sparkles;
    },

    time: () => clock,
  };
}
