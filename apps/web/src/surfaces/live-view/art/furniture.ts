import type { DeskGroup } from "../live-view-types.ts";
import { seededRandom, pickFrom } from "../seeded.ts";
import { DESK_H } from "./iso.ts";
import { ART as A, GROUP_ART } from "./palettes.ts";
import { type ArtShape, type IsoBounds, isoShape } from "./pixel-grid.ts";

/** Where each monitor stands along the desk, by how many it holds (one to three). */
export function monitorSlots(count: number): readonly number[] {
  if (count <= 1) return [1];
  if (count === 2) return [0.72, 1.28];
  return [0.5, 1, 1.5];
}

const DESK_BOUNDS: IsoBounds = { maxX: 1, maxY: 2, maxZ: 26 };

/** A desk, 1 × 2 tiles, its low divider at the back and its monitors facing you (a laptop for someone who only talks). */
export function deskShape(group: DeskGroup, monitors: number, laptop: boolean): ArtShape {
  return isoShape(DESK_BOUNDS, (pen) => {
    const art = GROUP_ART[group];
    pen.box(0, 0.02, 0, 0.1, 1.96, 15, art.divider, art.dividerSide, art.divider);
    pen.box(0.12, 0.06, 0, 0.82, 1.88, DESK_H, A.deskTop, A.deskLeft, A.deskRight, A.deskEdge);
    if (laptop) {
      pen.box(0.42, 0.78, DESK_H, 0.36, 0.44, 1, A.monitorSide, A.monitorFrame, A.monitorFrame);
      pen.box(0.36, 0.78, DESK_H + 1, 0.05, 0.44, 7, A.monitorSide, A.monitorSide, A.monitorFrame);
      pen.faceX(0.41, 0.82, 1.18, DESK_H + 2, DESK_H + 7, A.screenOff);
      return;
    }
    for (const centre of monitorSlots(monitors)) {
      pen.box(0.3, centre - 0.05, DESK_H, 0.05, 0.1, 1, A.stand, A.stand, A.stand);
      pen.box(
        0.3,
        centre - 0.22,
        DESK_H + 1,
        0.06,
        0.44,
        10,
        A.monitorSide,
        A.monitorSide,
        A.monitorFrame,
      );
      pen.faceX(0.36, centre - 0.18, centre + 0.18, DESK_H + 2, DESK_H + 10, A.screenOff);
    }
  });
}

/** Lines of code on a lit screen: indent and length along the screen, and their colour. */
const CODE: readonly (readonly [indent: number, length: number, index: number])[] = [
  [0.02, 0.22, A.codeA],
  [0.08, 0.16, A.codeB],
  [0.02, 0.26, A.codeC],
  [0.12, 0.12, A.codeA],
  [0.02, 0.18, A.codeB],
  [0.08, 0.22, A.codeA],
];

/** One monitor's screen, lit: drawn untinted over the desk, its lines of code scrolling by frame. */
export function screenShape(centre: number, frame: number, laptop: boolean): ArtShape {
  return isoShape(DESK_BOUNDS, (pen) => {
    const x = laptop ? 0.41 : 0.36;
    const half = 0.18;
    const z0 = DESK_H + 2;
    const z1 = laptop ? DESK_H + 7 : DESK_H + 10;
    pen.faceX(x, centre - half, centre + half, z0, z1, A.screenLit);
    const rows = laptop ? 2 : 3;
    for (let row = 0; row < rows; row++) {
      const [indent, length, index] = CODE[(row + frame) % CODE.length] ?? [0, 0, A.codeA];
      const z = z1 - 2 - row * 2;
      pen.line(
        [x, centre - half + 0.04 + indent, z],
        [x, centre - half + 0.04 + indent + length, z],
        index,
      );
    }
  });
}

const CHAIR_BOUNDS: IsoBounds = { minX: -0.4, maxX: 0.4, minY: -0.4, maxY: 0.4, maxZ: 18 };

/** A chair's base and seat, drawn before whoever sits on it. */
export function chairSeatShape(): ArtShape {
  return isoShape(CHAIR_BOUNDS, (pen) => {
    pen.box(-0.26, -0.03, 0, 0.52, 0.06, 1, A.chairBase, A.chairBase, A.chairBase);
    pen.box(-0.03, -0.26, 0, 0.06, 0.52, 1, A.chairBase, A.chairBase, A.chairBase);
    pen.box(-0.03, -0.03, 1, 0.06, 0.06, 3, A.chairBase, A.chairBase, A.chairBase);
    pen.box(-0.24, -0.24, 4, 0.48, 0.48, 1, A.chairSeat, A.chairSeatSide, A.chairSeatSide);
  });
}

/** Which side of the seat a chair's back stands on. */
export type ChairBackSide = "+x" | "-x" | "+y" | "-y";

const CHAIR_BACKS: Readonly<
  Record<ChairBackSide, readonly [x: number, y: number, w: number, d: number]>
> = {
  "+x": [0.18, -0.22, 0.08, 0.44],
  "-x": [-0.26, -0.22, 0.08, 0.44],
  "+y": [-0.22, 0.18, 0.44, 0.08],
  "-y": [-0.22, -0.26, 0.44, 0.08],
};

/** A chair's back, on the side it stands: "+x" faces the desk, "-x" is turned round. */
export function chairBackShape(side: ChairBackSide): ArtShape {
  return isoShape(CHAIR_BOUNDS, (pen) => {
    const [x, y, w, d] = CHAIR_BACKS[side];
    pen.box(x, y, 5, w, d, 10, A.chairBack, A.chairBackSide, A.chairBack);
  });
}

export function sofaShape(seats: number): ArtShape {
  return isoShape({ maxX: seats, maxY: 0.95, maxZ: 18 }, (pen) => {
    pen.box(0, 0, 0, seats, 0.3, 15, A.sofaTop, A.sofaLeft, A.sofaRight);
    pen.box(0, 0.12, 0, seats, 0.8, 6, A.cushion, A.sofaLeft, A.sofaRight);
    for (let i = 1; i < seats; i++) pen.line([i, 0.32, 6], [i, 0.92, 6], A.sofaLeft);
    pen.box(0, 0.12, 6, 0.22, 0.8, 4, A.sofaTop, A.sofaLeft, A.sofaRight);
    pen.box(seats - 0.22, 0.12, 6, 0.22, 0.8, 4, A.sofaTop, A.sofaLeft, A.sofaRight);
  });
}

/** The beanbags' colours and shades, by `Amenity.variant`. */
const BEANBAG_COLOURS: readonly (readonly [colour: number, shade: number])[] = [
  [A.beanA, A.beanAShade],
  [A.beanB, A.beanBShade],
  [A.beanC, A.beanCShade],
];

/** A beanbag in one of the three colours, by its variant from 0. */
export function beanbagShape(variant: number): ArtShape {
  const [colour, shade] = BEANBAG_COLOURS[Math.abs(variant) % BEANBAG_COLOURS.length] ?? [
    A.beanA,
    A.beanAShade,
  ];
  return isoShape({ minX: -0.45, maxX: 0.45, minY: -0.45, maxY: 0.45, maxZ: 10 }, (pen) => {
    pen.ellipse(0, 0, 2, 8, 5, shade);
    pen.ellipse(-0.04, -0.04, 4, 7, 4, colour);
    pen.ellipse(-0.12, -0.12, 6, 3, 2, colour);
  });
}

export function coffeeTableShape(width: number): ArtShape {
  return isoShape({ maxX: width, maxY: 0.5, maxZ: 10 }, (pen) => {
    pen.box(0, 0, 0, width, 0.5, 5, A.tableTop, A.tableSide, A.tableSide, A.deskEdge);
    pen.box(width * 0.3, 0.18, 5, 0.12, 0.12, 2, A.mug, A.mug, A.deskLeft);
    pen.box(width * 0.62, 0.12, 5, 0.12, 0.12, 2, A.mug, A.mug, A.deskLeft);
  });
}

/** The exercise mat's size in tiles: one across, two deep (`floor-plan.ts`'s `MAT`). */
const MAT = { width: 1, length: 2 } as const;
/** How far in from the mat's tiles its edges are, in tiles. */
const MAT_INSET = 0.08;
/** The rolled edge at the mat's far end, in tiles deep. */
const MAT_ROLL = 0.14;
/** How far in from the mat's edges its stripes run, in tiles. */
const MAT_STRIPE_IN = 0.1;

/** A flat mat on the floor, a pixel thick, rolled at its far end, a stripe along each side. */
export function exerciseMatShape(): ArtShape {
  return isoShape({ maxX: MAT.width, maxY: MAT.length, maxZ: 3 }, (pen) => {
    const x0 = MAT_INSET;
    const x1 = MAT.width - MAT_INSET;
    const y0 = MAT_INSET;
    const y1 = MAT.length - MAT_INSET;
    pen.box(x0, y0, 0, x1 - x0, y1 - y0, 1, A.mat, A.matSide, A.matSide);
    for (const x of [x0 + MAT_STRIPE_IN, x1 - MAT_STRIPE_IN]) {
      pen.line([x, y0 + MAT_ROLL, 1], [x, y1 - MAT_STRIPE_IN, 1], A.matStripe);
    }
    pen.box(x0, y0, 1, x1 - x0, MAT_ROLL, 2, A.mat, A.matSide, A.matSide);
  });
}

/** The floor pillows' colours and shades, by `Amenity.variant`. */
const PILLOW_COLOURS: readonly (readonly [colour: number, shade: number])[] = [
  [A.pillowA, A.pillowAShade],
  [A.pillowB, A.pillowBShade],
  [A.pillowC, A.pillowCShade],
];

/**
 * How high a floor pillow is, in art pixels: a pixel under a desk chair's seat, so whoever sits on
 * one has a `seatZ` of -1 (`floor-plan.ts`).
 */
const FLOOR_PILLOW_H = 4;

/** A plump square floor pillow in one of three colours, by its variant from 0; its origin its middle. */
export function floorPillowShape(variant: number): ArtShape {
  const [colour, shade] = PILLOW_COLOURS[Math.abs(variant) % PILLOW_COLOURS.length] ?? [
    A.pillowA,
    A.pillowAShade,
  ];
  return isoShape({ minX: -0.45, maxX: 0.45, minY: -0.45, maxY: 0.45, maxZ: 8 }, (pen) => {
    pen.box(-0.32, -0.32, 0, 0.64, 0.64, FLOOR_PILLOW_H - 1, colour, shade, shade);
    pen.box(-0.27, -0.27, FLOOR_PILLOW_H - 1, 0.54, 0.54, 1, colour, colour, shade);
    pen.floor(-0.04, -0.04, 0.04, 0.04, shade, FLOOR_PILLOW_H);
  });
}

/** The TV stand's extent, the TV on it included; the TV's screen is drawn at the same anchor. */
const TV_BOUNDS: IsoBounds = { maxX: 2.2, maxY: 0.6, maxZ: 34 };
/** The low stand's height, in art pixels. */
const TV_STAND_H = 7;
/** The TV's screen: the face it is on (y), its ends along x and its bottom and top heights. */
const TV_SCREEN = { y: 0.28, x0: 0.2, x1: 2.0, z0: TV_STAND_H + 4, z1: TV_STAND_H + 22 } as const;

/**
 * A big flat TV on a low stand against the back wall, the games console on the stand's open shelf
 * with its small light; the screen dark (`tvScreenShape` paints it lit, untinted, over this).
 */
export function tvStandShape(): ArtShape {
  return isoShape(TV_BOUNDS, (pen) => {
    pen.box(0, 0.1, 0, 2.2, 0.5, TV_STAND_H, A.tvStand, A.tvStandSide, A.tvStandRight, A.deskEdge);
    // The open shelf under the top, and the console in it.
    pen.faceY(0.6, 0.15, 2.05, 1, TV_STAND_H - 2, A.tvStandRight);
    pen.box(0.75, 0.32, 1, 0.7, 0.28, 3, A.consoleTop, A.consoleBody, A.consoleBody);
    pen.faceY(0.6, 1.3, 1.37, 2, 3, A.consoleLight);
    // The TV on its foot.
    pen.box(1.0, 0.24, TV_STAND_H, 0.2, 0.16, 2, A.stand, A.stand, A.stand);
    const { y, x0, x1, z0, z1 } = TV_SCREEN;
    pen.box(
      0.1,
      0.2,
      TV_STAND_H + 2,
      2.0,
      y - 0.2,
      22,
      A.monitorSide,
      A.monitorFrame,
      A.monitorSide,
    );
    pen.faceY(y, x0, x1, z0, z1, A.screenOff);
  });
}

/**
 * The TV's screen, lit with a game: a sky with a cloud, the ground, two little characters and a
 * coin between them; frame 1 moves them a step and bobs the coin. Drawn untinted over the TV stand.
 */
export function tvScreenShape(frame: number): ArtShape {
  return isoShape(TV_BOUNDS, (pen) => {
    const { y, x0, x1, z0, z1 } = TV_SCREEN;
    const step = frame % 2 === 0 ? 0 : 0.08;
    pen.faceY(y, x0, x1, z0, z1, A.gameSky);
    pen.faceY(y, 0.45 + step / 2, 0.85 + step / 2, z1 - 5, z1 - 3, A.gameCloud);
    pen.faceY(y, 1.4 - step / 2, 1.65 - step / 2, z1 - 8, z1 - 7, A.gameCloud);
    pen.faceY(y, x0, x1, z0, z0 + 2, A.gameDirt);
    pen.faceY(y, x0, x1, z0 + 2, z0 + 4, A.gameGround);
    pen.faceY(y, 0.55 + step, 0.7 + step, z0 + 4, z0 + 9, A.gameHeroA);
    pen.faceY(y, 1.5 - step, 1.65 - step, z0 + 4, z0 + 9, A.gameHeroB);
    pen.faceY(y, 1.06, 1.14, z0 + 11 + (frame % 2), z0 + 13 + (frame % 2), A.gameCoin);
  });
}

export function coffeeMachineShape(): ArtShape {
  return isoShape({ maxX: 0.9, maxY: 0.7, maxZ: 28 }, (pen) => {
    pen.box(0, 0, 0, 0.9, 0.7, 11, A.cabinet, A.cabinetSide, A.cabinetRight, A.deskEdge);
    pen.box(0.15, 0.05, 11, 0.6, 0.45, 13, A.machineTop, A.machineSide, A.machine);
    pen.faceY(0.5, 0.32, 0.58, 13, 19, A.monitorSide);
    pen.box(0.38, 0.5, 11, 0.1, 0.1, 2, A.mug, A.mug, A.deskLeft);
  });
}

export function waterCoolerShape(): ArtShape {
  return isoShape({ maxX: 0.8, maxY: 0.7, maxZ: 26 }, (pen) => {
    pen.box(0.2, 0.1, 0, 0.42, 0.42, 14, A.cooler, A.coolerSide, A.coolerSide);
    pen.box(0.26, 0.16, 14, 0.3, 0.3, 8, A.water, A.waterSide, A.waterSide);
  });
}

export function plantShape(tall: boolean): ArtShape {
  return isoShape({ minX: -0.4, maxX: 0.4, minY: -0.4, maxY: 0.4, maxZ: tall ? 34 : 24 }, (pen) => {
    const potHeight = tall ? 9 : 6;
    pen.box(-0.17, -0.17, 0, 0.34, 0.34, potHeight, A.potTop, A.potSide, A.potRight);
    const z = potHeight + (tall ? 12 : 8);
    pen.ellipse(0.02, 0.02, z - 2, tall ? 8 : 6, tall ? 10 : 7, A.leafDark);
    pen.ellipse(-0.03, -0.03, z, tall ? 7 : 5, tall ? 9 : 6, A.leaf);
    pen.ellipse(-0.12, -0.12, z + (tall ? 4 : 2), 3, 3, A.leafLight);
  });
}

/** A bookshelf, its books' widths, heights and colours drawn from the seed. */
export function bookshelfShape(seed: number): ArtShape {
  return isoShape({ maxX: 1.6, maxY: 0.45, maxZ: 30 }, (pen) => {
    pen.box(0, 0, 0, 1.6, 0.4, 27, A.cabinet, A.cabinetSide, A.cabinetRight, A.deskEdge);
    const random = seededRandom(seed);
    const books = [A.bookA, A.bookB, A.bookC, A.bookD, A.bookE] as const;
    for (const z of [3, 12, 21]) {
      pen.faceY(0.4, 0.06, 1.54, z - 1, z + 6, A.cabinetRight);
      let x = 0.1;
      while (x < 1.45) {
        const width = 0.06 + random() * 0.06;
        const height = 4 + Math.floor(random() * 3);
        pen.faceY(0.4, x, Math.min(1.5, x + width), z, z + height, pickFrom(random, books));
        x += width + 0.02;
      }
    }
  });
}

export function printerShape(): ArtShape {
  return isoShape({ maxX: 0.9, maxY: 0.7, maxZ: 22 }, (pen) => {
    pen.box(0, 0, 0, 0.9, 0.7, 10, A.cabinet, A.cabinetSide, A.cabinetRight, A.deskEdge);
    pen.box(0.08, 0.08, 10, 0.74, 0.54, 7, A.printerTop, A.printerSide, A.printer);
    pen.floor(0.25, 0.2, 0.6, 0.45, A.paper, 17);
  });
}

/** A desk lamp, on at dusk and night while someone sits at the desk; the stage paints its bulb, untinted. */
export function lampShape(): ArtShape {
  return isoShape({ minX: -0.3, maxX: 0.3, minY: -0.3, maxY: 0.3, maxZ: 24 }, (pen) => {
    pen.box(-0.08, -0.08, DESK_H, 0.16, 0.16, 1, A.lampBody, A.lampBody, A.lampBody);
    pen.line([0, 0, DESK_H + 1], [0.06, 0, DESK_H + 9], A.lampBody);
    pen.box(0, -0.1, DESK_H + 8, 0.2, 0.2, 3, A.lampShade, A.lampShadeSide, A.lampShade);
  });
}

/** A pizza box on the desk of some who work at night. */
export function pizzaShape(): ArtShape {
  return isoShape({ minX: -0.3, maxX: 0.3, minY: -0.3, maxY: 0.3, maxZ: 14 }, (pen) => {
    pen.box(-0.2, -0.2, DESK_H, 0.4, 0.4, 2, A.pizzaTop, A.pizzaSide, A.pizzaSide);
    pen.floor(-0.05, -0.05, 0.05, 0.05, A.pizzaLogo, DESK_H + 2);
  });
}

/** The door in the left wall, closed or open; its origin at the wall, at the main aisle's row. */
export function doorShape(open: boolean): ArtShape {
  return isoShape({ minX: -0.1, maxX: 0.8, minY: 0, maxY: 1, maxZ: 40 }, (pen) => {
    pen.faceX(0, 0.1, 0.9, 0, 35, A.doorFrame);
    if (!open) {
      pen.faceX(0, 0.16, 0.84, 0, 33, A.doorPanel);
      pen.faceX(0, 0.24, 0.76, 20, 30, A.doorPanelShade);
      pen.faceX(0, 0.24, 0.76, 4, 16, A.doorPanelShade);
      pen.faceX(0, 0.7, 0.76, 16, 18, A.doorHandle);
      return;
    }
    pen.faceX(0, 0.16, 0.84, 0, 33, A.doorway);
    pen.box(0, 0.12, 0, 0.66, 0.05, 33, A.doorPanelShade, A.doorPanel, A.doorPanelShade);
  });
}
