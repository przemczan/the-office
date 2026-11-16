import type {
  Amenities,
  Amenity,
  Desk,
  DeskGroup,
  FloorPoint,
  Layout,
  OfficePerson,
  PodColumn,
  Seat,
  Spot,
} from "./live-view-types.ts";

/** The main aisle along the back wall's furniture, with the door at its left end. */
export const AISLE_ROW = 3;
/** The first row of pods. */
const POD_TOP = 4;
/** Where the chill area starts along the back wall, past the meeting spot. */
const CHILL_START = 5;

/** The groups, in the order they fill the floor from the door (design decision 5). */
export const DESK_GROUPS: readonly DeskGroup[] = ["front-desk", "consultants", "team"];

/** What the person's Role card makes of them: someone who only talks, a Consultant, or the team. */
export function groupOf(person: Pick<OfficePerson, "taskLimit" | "consultant">): DeskGroup {
  if (person.taskLimit === "none") return "front-desk";
  return person.consultant ? "consultants" : "team";
}

export interface PodShape {
  readonly perPod: number;
  readonly rows: number;
}

/** Desks per pod and pod rows, from how many people the floor holds. */
export function podShapeFor(count: number): PodShape {
  if (count <= 10) return { perPod: 2, rows: 1 };
  if (count <= 18) return { perPod: 2, rows: 2 };
  return { perPod: 3, rows: 2 };
}

/** The floor laid out for everyone, front desk first, then Consultants, then everyone else. */
export function layoutOffice(people: readonly OfficePerson[]): Layout {
  const count = people.length;
  const { perPod, rows } = podShapeFor(count);
  const sofaSeats = count > 10 ? 6 : 3;
  const chillEnd = CHILL_START + sofaSeats + 3;
  const layout: Layout = {
    perPod,
    rows,
    columns: [],
    desks: [],
    sofaSeats,
    beanbags: count <= 4 ? 1 : count <= 10 ? 2 : 3,
    chillStart: CHILL_START,
    chillEnd,
    depth: POD_TOP + rows * (2 * perPod + 1),
    // At least the back wall's furniture; each pod column placed below widens it as it must.
    width: chillEnd + 1,
  };
  for (const group of DESK_GROUPS) {
    for (const person of people) {
      if (groupOf(person) === group) placeDesk(layout, group, person.roleKey);
    }
  }
  return layout;
}

export function deskOf(layout: Layout, roleKey: string): Desk | null {
  return layout.desks.find((desk) => desk.roleKey === roleKey) ?? null;
}

/**
 * A desk for someone: their group's first free desk (one left by someone let go counts), or a new
 * pod column at the floor's right end, which widens the floor. Desks already taken never move.
 */
export function placeDesk(layout: Layout, group: DeskGroup, roleKey: string): Desk {
  const free = layout.desks.find((desk) => desk.group === group && desk.roleKey === null);
  if (free) {
    free.roleKey = roleKey;
    free.formerKey = null;
    return free;
  }
  const column = columnWithRoom(layout, group) ?? openColumn(layout, group);
  const slot = firstFreeSlot(layout, column);
  const podRow = Math.floor(slot / layout.perPod);
  const inPod = slot % layout.perPod;
  const x = column.x;
  const y = POD_TOP + podRow * (2 * layout.perPod + 1) + 2 * inPod;
  const desk: Desk = { roleKey, formerKey: null, group, column, slot, x, y, depth: x + y + 1.5 };
  layout.desks.push(desk);
  return desk;
}

function columnWithRoom(layout: Layout, group: DeskGroup): PodColumn | undefined {
  const capacity = layout.perPod * layout.rows;
  return layout.columns.find(
    (column) =>
      column.group === group &&
      layout.desks.filter((desk) => desk.column === column).length < capacity,
  );
}

function openColumn(layout: Layout, group: DeskGroup): PodColumn {
  const column: PodColumn = { group, x: 1 + 3 * layout.columns.length };
  layout.columns.push(column);
  layout.width = Math.max(layout.width, 1 + 3 * layout.columns.length);
  return column;
}

function firstFreeSlot(layout: Layout, column: PodColumn): number {
  const taken = new Set(
    layout.desks.filter((desk) => desk.column === column).map((desk) => desk.slot),
  );
  let slot = 0;
  while (taken.has(slot)) slot++;
  return slot;
}

/** A hire takes a desk by their group; someone who already has one keeps it. */
export function addHire(layout: Layout, person: OfficePerson): Desk {
  return deskOf(layout, person.roleKey) ?? placeDesk(layout, groupOf(person), person.roleKey);
}

/** Someone let go leaves their desk empty, chair pushed in, until a hire of the group takes it. */
export function letGo(layout: Layout, roleKey: string): void {
  const desk = deskOf(layout, roleKey);
  if (!desk) return;
  desk.roleKey = null;
  desk.formerKey = roleKey;
}

/** Sitting at the desk: reached from the aisle tile beside the chair, stepping out past it. */
export function deskSpot(desk: Desk): Spot {
  return {
    x: desk.x + 1.45,
    y: desk.y + 1,
    tile: { x: desk.x + 2, y: desk.y + 1 },
    exit: { x: desk.x + 2.4, y: desk.y + 1 },
  };
}

/** The empty chair, pushed in under the desk. */
export function pushedInSpot(desk: Desk): Spot {
  return { x: desk.x + 1.14, y: desk.y + 1 };
}

/** Standing in the aisle at a Consultant's desk, asking them. */
export function consultSpot(desk: Desk): Spot {
  return { x: desk.x + 2.4, y: desk.y + 1.3, tile: { x: desk.x + 2, y: desk.y + 1 } };
}

export const DOOR_OUTSIDE: Spot = {
  x: -1.1,
  y: AISLE_ROW + 0.5,
  tile: { x: 0, y: AISLE_ROW },
  exit: { x: 0.5, y: AISLE_ROW + 0.5 },
};

/**
 * Furniture blocks every tile it stands on, its chairs too, so nobody walks through it; the list
 * of blocked tiles is built alongside the furniture.
 */
class FurnitureList {
  readonly items: Amenity[] = [];
  readonly blocked: [number, number][] = [];

  block(x: number, y: number): void {
    this.blocked.push([x, y]);
  }
}

/**
 * The meeting spot, the chill area, the exercise mat and the furniture along the back wall, with
 * their seats and every pastime's spots.
 */
export function amenitiesOf(layout: Layout): Amenities {
  const furniture = new FurnitureList();
  const meetingSeats = meetingSpot(furniture);
  const pastimeSpots = [
    ...chillArea(furniture, layout),
    ...exerciseMat(furniture),
    ...backWallDecor(furniture, layout),
  ];
  return { items: furniture.items, blocked: furniture.blocked, meetingSeats, pastimeSpots };
}

const MEETING_CHAIRS: readonly {
  readonly x: number;
  readonly y: number;
  readonly facing: Seat["facing"];
  readonly back: "-y" | "+y";
}[] = [
  { x: 2.15, y: 0.62, facing: "front", back: "-y" },
  { x: 2.95, y: 0.62, facing: "front", back: "-y" },
  { x: 2.15, y: 2.55, facing: "back", back: "+y" },
  { x: 2.95, y: 2.55, facing: "back", back: "+y" },
];

/** A table for four, a whiteboard on the wall behind it; seat 0 is where a Consultant sits. */
function meetingSpot(furniture: FurnitureList): Seat[] {
  furniture.items.push({ kind: "meetingTable", x: 1.6, y: 1.2, depth: 1.6 + 0.9 + 1.2 + 0.4 });
  for (const x of [1, 2, 3]) furniture.block(x, 1);
  // Its chairs block their tiles too: the back pair is reached from the aisle, the front pair from
  // either end of the row along the wall.
  for (const x of [1, 2, 3]) furniture.block(x, 2);
  furniture.block(2, 0);
  return MEETING_CHAIRS.map(({ x, y, facing, back }) => ({
    kind: "meeting",
    x,
    y,
    tile: y < 1 ? { x: x < 2.5 ? 1 : 3, y: 0 } : { x: Math.floor(x), y: AISLE_ROW },
    facing,
    mirrored: true,
    chairBack: back,
    depth: x + y,
    seatZ: 0,
  }));
}

/** A plant, the sofa, the coffee machine and water, beanbags round a low table. */
function chillArea(furniture: FurnitureList, layout: Layout): Seat[] {
  const start = layout.chillStart;
  const seats = layout.sofaSeats;
  const chillSeats: Seat[] = [];
  furniture.items.push({ kind: "plant", x: start + 0.5, y: 0.45, tall: true, depth: start + 0.95 });
  furniture.block(start, 0);
  chillSeats.push(facingTheWall("plant", start + 0.5, start));
  // The sofa sorts by its front-left corner, not its middle: it stands against the wall, so nothing
  // is ever behind it, and anyone getting up from a seat or passing in front stays in front of it.
  const sofaDepth = start + 1 + 0.95;
  furniture.items.push({ kind: "sofa", x: start + 1, y: 0.08, seats, depth: sofaDepth });
  for (let seat = 0; seat < seats; seat++) {
    furniture.block(start + 1 + seat, 0);
    chillSeats.push({
      kind: "sofa",
      x: start + 1.5 + seat,
      y: 0.66,
      tile: { x: start + 1 + seat, y: 1 },
      facing: "front",
      mirrored: true,
      depth: sofaDepth + 0.05 + seat * 0.01,
      seatZ: 1,
    });
  }
  const coffeeX = start + seats + 1;
  furniture.items.push({ kind: "coffeeMachine", x: coffeeX + 0.05, y: 0.08, depth: coffeeX + 0.9 });
  furniture.block(coffeeX, 0);
  furniture.items.push({ kind: "waterCooler", x: coffeeX + 1, y: 0.05, depth: coffeeX + 1.8 });
  furniture.block(coffeeX + 1, 0);
  chillSeats.push(
    standingSpot("coffee", { x: coffeeX + 0.5, y: 1.35 }, { x: coffeeX, y: 1 }, true),
    standingSpot("water", { x: coffeeX + 1.35, y: 1.55 }, { x: coffeeX + 1, y: 1 }, false),
  );
  const tableX = start + 1.7;
  const tableWidth = Math.max(0.8, seats - 1.4);
  // Low and long, it too sorts by its front-left corner: by its middle, the six-seat sofa's table
  // covered the heads of people passing along the aisle in front of it.
  furniture.items.push({
    kind: "coffeeTable",
    x: tableX,
    y: 2.1,
    width: tableWidth,
    depth: tableX + 2.6,
  });
  for (let x = Math.floor(tableX); x < tableX + tableWidth; x++) furniture.block(x, 2);
  const beanbags = [
    { x: start + 0.55, y: 2.4, mirrored: false },
    { x: start + seats + 1.5, y: 2.4, mirrored: true },
    { x: start + seats + 2.5, y: 2.45, mirrored: true },
  ].slice(0, layout.beanbags);
  beanbags.forEach(({ x, y, mirrored }, variant) => {
    furniture.items.push({ kind: "beanbag", x, y, variant, depth: x + y });
    furniture.block(Math.floor(x), 2);
    chillSeats.push({
      kind: "beanbag",
      x,
      y,
      tile: { x: Math.floor(x), y: 1 },
      facing: "front",
      mirrored,
      depth: x + y + 0.01,
      seatZ: 1,
    });
  });
  return chillSeats;
}

/** Standing by the coffee machine or the water cooler: sorted by the feet, as a standing figure is. */
function standingSpot(
  kind: "coffee" | "water",
  at: FloorPoint,
  tile: FloorPoint,
  mirrored: boolean,
): Seat {
  return { kind, ...at, tile, facing: "front", mirrored, depth: null, seatZ: 0 };
}

/**
 * Standing in front of something on the back wall, back to us: a bookshelf or a plant. Mirrored, as
 * the back view looks along -x and the wall is along -y.
 */
function facingTheWall(kind: "bookshelf" | "plant", x: number, tileX: number): Seat {
  return {
    kind,
    x,
    y: 1.25,
    tile: { x: tileX, y: 1 },
    facing: "back",
    mirrored: true,
    depth: null,
    seatZ: 0,
  };
}

/**
 * The exercise mat's tiles: one across and two deep, in the column between the meeting spot and the
 * chill area, which every floor has (`exerciseMatShape` draws it at this size).
 */
const MAT = { x: 4, y: 1, length: 2 } as const;

/**
 * A mat flat on the floor, between the meeting spot and the chill area, with a spot on each of its
 * tiles. It blocks no tile, so routes cross it, and sorts under everything standing on it.
 */
function exerciseMat(furniture: FurnitureList): Seat[] {
  furniture.items.push({ kind: "exerciseMat", x: MAT.x, y: MAT.y, depth: 0 });
  return Array.from({ length: MAT.length }, (_, index) => ({
    kind: "exercise",
    x: MAT.x + 0.5,
    y: MAT.y + index + 0.5,
    tile: { x: MAT.x, y: MAT.y + index },
    facing: "front",
    mirrored: false,
    depth: null,
    seatZ: 0,
  }));
}

const DECOR: readonly ("bookshelf" | "plant" | "printer")[] = [
  "bookshelf",
  "plant",
  "printer",
  "plant",
];

/**
 * Along the back wall past the chill area: shelves, a printer and plants, as far as it reaches.
 * Answers a spot in front of each bookshelf and each plant.
 */
function backWallDecor(furniture: FurnitureList, layout: Layout): Seat[] {
  const spots: Seat[] = [];
  let index = 0;
  for (let x = layout.chillEnd + 0.2; x < layout.width - 1.2;) {
    const kind = DECOR[index % DECOR.length]!;
    if (kind === "bookshelf" && x + 1.6 > layout.width - 0.5) break;
    if (kind === "bookshelf") {
      furniture.items.push({ kind, x, y: 0.05, seed: index + 7, depth: x + 0.8 + 0.25 });
      spots.push(facingTheWall("bookshelf", x + 0.8, Math.floor(x + 0.8)));
    } else if (kind === "printer") {
      furniture.items.push({ kind, x, y: 0.06, depth: x + 0.45 + 0.4 });
    } else {
      furniture.items.push({ kind, x: x + 0.4, y: 0.45, tall: index % 4 === 1, depth: x + 0.85 });
      spots.push(facingTheWall("plant", x + 0.45, Math.floor(x + 0.4)));
    }
    const span = kind === "bookshelf" ? 1.6 : 0.9;
    for (let tile = Math.floor(x); tile < x + span; tile++) furniture.block(tile, 0);
    x += kind === "bookshelf" ? 2 : 1.2;
    index++;
  }
  return spots;
}

/** Which tiles a figure may walk on, row by row (`y * width + x`): 1 walkable, 0 not. */
export type Walkable = Uint8Array;

/** The tiles a figure may walk on: everything but desks, chairs and furniture. */
export function walkableOf(layout: Layout, amenities: Amenities): Walkable {
  const walkable = new Uint8Array(layout.width * layout.depth).fill(1);
  const block = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < layout.width && y < layout.depth)
      walkable[y * layout.width + x] = 0;
  };
  // A desk with its chair stands on two tiles across and two deep.
  for (const desk of layout.desks) {
    for (const dy of [0, 1]) {
      block(desk.x, desk.y + dy);
      block(desk.x + 1, desk.y + dy);
    }
  }
  for (const [x, y] of amenities.blocked) block(x, y);
  return walkable;
}

export function isWalkable(layout: Layout, walkable: Walkable, x: number, y: number): boolean {
  return (
    x >= 0 && y >= 0 && x < layout.width && y < layout.depth && walkable[y * layout.width + x] === 1
  );
}
