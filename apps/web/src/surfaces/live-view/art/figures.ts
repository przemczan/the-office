import type { FigurePose } from "../live-view-types.ts";
import { pickFrom, seedOf, seededRandom } from "../seeded.ts";
import { type AvatarTone } from "./palettes.ts";
import {
  type ArtShape,
  type PaintedArt,
  PixelGrid,
  darker,
  lighter,
  paintedArt,
} from "./pixel-grid.ts";

/* ---------- Figures: generated from the Role key, layered, recoloured by palette ---------- */

export const FIGURE = {
  width: 20,
  height: 30,
  anchorX: 10,
  anchorY: 28,
  ground: 27,
  centre: 10,
} as const;

/** A figure's palette indexes. */
export const F = {
  outline: 1,
  skin: 2,
  skinShade: 3,
  hair: 4,
  hairShade: 5,
  top: 6,
  topShade: 7,
  trim: 8,
  legs: 9,
  legsShade: 10,
  shoes: 11,
  eye: 12,
  extra: 13,
  extraLight: 14,
  mug: 15,
  device: 16,
  screen: 17,
  book: 18,
  can: 19,
  canShade: 20,
  water: 21,
} as const;

/** What a pastime holds: the phone, the book and the watering can, the same for everyone. */
const PROP_COLOURS = {
  device: 0x2b2e35,
  screen: 0x9fd6ff,
  book: 0xc8102e,
  can: 0x4f9b59,
  canShade: 0x3a7a45,
  water: 0x8fc9f2,
} as const satisfies Partial<Record<keyof typeof F, number>>;

type ColourPair = readonly [colour: number, shade: number];

export const SKINS = [
  [0xf7d9c4, 0xe6bca2],
  [0xefc4a1, 0xd9a67f],
  [0xd9a174, 0xbf8457],
  [0xb97b52, 0x9c6340],
  [0x8e5b3c, 0x74472e],
  [0x5f3b27, 0x4a2d1d],
] as const satisfies readonly ColourPair[];
export const HAIRS = [
  [0x2a2321, 0x1a1514],
  [0x4a3326, 0x35241a],
  [0x7a4e2d, 0x5e3a20],
  [0xa8552e, 0x86401f],
  [0xdcb66d, 0xb99450],
  [0xbdbab4, 0x9a9790],
  [0x5b4a8a, 0x45386c],
] as const satisfies readonly ColourPair[];
export const TROUSERS = [
  [0x40454f, 0x30343c],
  [0x3e5b86, 0x2f466a],
  [0xa68f6a, 0x8a7553],
  [0x2d2d30, 0x1f1f22],
] as const satisfies readonly ColourPair[];
export const SHOES = [0x2a2522, 0x5a3d2b, 0xefefec, 0x3b3f46] as const;
export const BUILDS = ["slim", "regular", "broad"] as const;
export const HAIR_STYLES = [
  "bald",
  "buzz",
  "short",
  "swept",
  "bob",
  "long",
  "bun",
  "curly",
] as const;
export const TOPS = ["tee", "hoodie", "jacket"] as const;
/** "none" twice: most people wear nothing extra. */
export const ACCESSORIES = ["none", "none", "glasses", "headphones", "beard", "scarf"] as const;
export const LAYERS = ["body", "clothes", "hair", "accessory"] as const;

export type Build = (typeof BUILDS)[number];
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Top = (typeof TOPS)[number];
export type Accessory = (typeof ACCESSORIES)[number];
export type FigureLayer = (typeof LAYERS)[number];

/** What a Role key gives; `skin`, `hair`, `trousers` and `shoes` are indexes into their lists. */
export interface FigureLook {
  readonly build: Build;
  readonly tall: boolean;
  readonly skin: number;
  readonly hairStyle: HairStyle;
  readonly hair: number;
  readonly top: Top;
  readonly accessory: Accessory;
  readonly trousers: number;
  readonly shoes: number;
}

const looks = new Map<string, FigureLook>();

/** What a Role key gives: drawn in this order from one seeded random, so it never changes. */
export function lookOf(roleKey: string): FigureLook {
  let look = looks.get(roleKey);
  if (!look) {
    const random = seededRandom(seedOf(roleKey));
    // The object literal's order is the draw order: changing it changes everyone's figure.
    look = {
      build: pickFrom(random, BUILDS),
      tall: random() < 0.5,
      skin: Math.floor(random() * SKINS.length),
      hairStyle: pickFrom(random, HAIR_STYLES),
      hair: Math.floor(random() * HAIRS.length),
      top: pickFrom(random, TOPS),
      accessory: pickFrom(random, ACCESSORIES),
      trousers: Math.floor(random() * TROUSERS.length),
      shoes: Math.floor(random() * SHOES.length),
    };
    looks.set(roleKey, look);
  }
  return look;
}

const pairOf = (list: readonly ColourPair[], index: number): ColourPair =>
  list[index] ?? list[0] ?? [0, 0];

/** A figure's palette: its look's colours, its top in the person's Avatar tint. */
export function figureColors(look: FigureLook, tone: AvatarTone): (number | null)[] {
  const hair = pairOf(HAIRS, look.hair);
  const extras: Readonly<Record<Accessory, ColourPair>> = {
    none: [0x000000, 0x000000],
    glasses: [0x26232a, 0xcfe6ff],
    headphones: [0x30333a, tone.light],
    beard: [hair[1], hair[0]],
    scarf: [tone.light, lighter(tone.light, 0.5)],
  };
  const [extra, extraLight] = extras[look.accessory];
  const skin = pairOf(SKINS, look.skin);
  const trousers = pairOf(TROUSERS, look.trousers);
  const colors: (number | null)[] = Array.from(
    { length: Math.max(...Object.values(F)) + 1 },
    () => null,
  );
  colors[F.outline] = 0x2b2428;
  colors[F.skin] = skin[0];
  colors[F.skinShade] = skin[1];
  colors[F.hair] = hair[0];
  colors[F.hairShade] = hair[1];
  colors[F.top] = tone.strong;
  colors[F.topShade] = darker(tone.strong, 0.3);
  colors[F.trim] = tone.light;
  colors[F.legs] = trousers[0];
  colors[F.legsShade] = trousers[1];
  colors[F.shoes] = SHOES[look.shoes] ?? SHOES[0];
  colors[F.eye] = 0x231d1f;
  colors[F.extra] = extra;
  colors[F.extraLight] = extraLight;
  colors[F.mug] = 0xf7f5f0;
  for (const [name, colour] of Object.entries(PROP_COLOURS))
    colors[F[name as keyof typeof PROP_COLOURS]] = colour;
  return colors;
}

export const figurePaletteKey = (look: FigureLook, tone: AvatarTone): string =>
  `fig-${look.skin}.${look.hair}.${look.trousers}.${look.shoes}.${look.accessory}.${tone.name}`;

export const figureShapeKey = (
  look: FigureLook,
  pose: FigurePose,
  frame: number,
  layers: readonly FigureLayer[] = LAYERS,
): string =>
  `fig:${look.build}.${look.tall ? 1 : 0}.${look.hairStyle}.${look.top}.${look.accessory}:${pose}:${frame}:${layers.join("+")}`;

/**
 * A figure lying along the floor's y axis (a push-up): its head up and to the right, its feet down
 * and to the left, its anchor the middle of the body on the floor. Wider than a standing figure's
 * grid, its anchor higher up it.
 */
export const LYING_FIGURE = { width: 28, height: 30, anchorX: 14, anchorY: 21 } as const;

/** Room on the left for what a figure holds out there: the open book and the watering can. */
const PROP_ROOM = 4;

/** A pose's grid: its size, the pixel its anchor lands on, and the column its body is centred on. */
export interface FigureGrid {
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly centre: number;
}

const STANDING_GRID: FigureGrid = FIGURE;
const PROP_GRID: FigureGrid = {
  ...FIGURE,
  width: FIGURE.width + PROP_ROOM,
  anchorX: FIGURE.anchorX + PROP_ROOM,
  centre: FIGURE.centre + PROP_ROOM,
};
const LYING_GRID: FigureGrid = { ...LYING_FIGURE, centre: LYING_FIGURE.anchorX };

export const isLying = (pose: FigurePose): boolean => pose.startsWith("lie");

export function figureGridOf(pose: FigurePose): FigureGrid {
  if (isLying(pose)) return LYING_GRID;
  return pose === "stand-back-read" || pose === "stand-back-water" ? PROP_GRID : STANDING_GRID;
}

/**
 * Where a figure reaches, in art pixels from its anchor (its feet, or a lying figure's middle):
 * the box it is pressed in, and how high its head's top is, for what is drawn over it.
 */
export interface FigureBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly head: number;
}

const FIGURE_BOUNDS = {
  standing: { left: -8, right: 8, top: -26, bottom: 2, head: 23 },
  seated: { left: -8, right: 8, top: -22, bottom: 2, head: 20 },
  // Either way round (mirrored or not) a lying figure's box is the same: it is centred on its middle.
  lying: { left: -12, right: 12, top: -19, bottom: 7, head: 15 },
} as const satisfies Record<string, FigureBounds>;

/** A pose's bounds; the same object every time, so a frame allocates nothing. */
export function figureBoundsOf(pose: FigurePose): FigureBounds {
  if (isLying(pose)) return FIGURE_BOUNDS.lying;
  return pose.startsWith("sit") ? FIGURE_BOUNDS.seated : FIGURE_BOUNDS.standing;
}

/** A figure's rows in a pose: where its feet, torso and head go. */
export interface FigureFrame {
  readonly seated: boolean;
  /** Lying along the floor: `paintLying` lays the rows' lengths out along the floor's y axis. */
  readonly lying: boolean;
  /** Down in a squat: the torso as low as a seated one's, the legs bent as a seated one's. */
  readonly squat: boolean;
  readonly stride: boolean;
  /** How far apart the feet are, in pixels each side: a jumping jack's. */
  readonly spread: number;
  /** Half the torso's width. */
  readonly half: number;
  readonly legRows: number;
  readonly torsoTop: number;
  readonly torsoBottom: number;
  readonly headTop: number;
  readonly cx: number;
}

const HALF_BY_BUILD: Readonly<Record<Build, number>> = { slim: 3, regular: 4, broad: 5 };
/** How far above the ground a seated figure's, or a squatting one's, torso ends. */
const SEATED_TORSO_ABOVE_GROUND = 4;
/** A jumping jack's feet, apart: pixels out on each side. */
const JACKS_SPREAD = 2;

export function figureFrame(look: FigureLook, pose: FigurePose, frame: number): FigureFrame {
  const seated = pose.startsWith("sit");
  const lying = isLying(pose);
  const squat = pose === "stand-front-squat" && frame % 2 === 0;
  const stride = pose.startsWith("walk") && frame % 2 === 1;
  const spread = pose === "stand-front-jacks" && frame % 2 === 0 ? JACKS_SPREAD : 0;
  const half = HALF_BY_BUILD[look.build];
  const legRows = look.tall ? 6 : 5;
  const torsoRows = look.tall ? 8 : 7;
  const torsoBottom =
    seated || squat
      ? FIGURE.ground - SEATED_TORSO_ABOVE_GROUND
      : FIGURE.ground - legRows - 1 + (stride ? 1 : 0);
  const torsoTop = torsoBottom - torsoRows + 1;
  const headTop = torsoTop - 8;
  const cx = figureGridOf(pose).centre;
  return {
    seated,
    lying,
    squat,
    stride,
    spread,
    half,
    legRows,
    torsoTop,
    torsoBottom,
    headTop,
    cx,
  };
}

/** Paints one figure; `layers` lets a sheet show body, clothes, hair and accessory one by one. */
export function paintFigure(
  grid: PixelGrid,
  look: FigureLook,
  pose: FigurePose,
  frame: number,
  layers: readonly FigureLayer[] = LAYERS,
): void {
  const g = figureFrame(look, pose, frame);
  if (g.lying) {
    paintLying(grid, look, frame, g, layers);
    return;
  }
  const back = pose.includes("back");
  const sleep = pose === "sit-back-sleep";
  const breathe = sleep ? frame % 2 : 0;
  // Looking down at the phone: the head nods a pixel.
  const nod = pose === "sit-front-phone" ? 1 : 0;
  const hx = g.cx - 4 + (sleep ? -3 : 0);
  const hy = g.headTop + (sleep ? 3 + breathe : nod);
  const has = (layer: FigureLayer): boolean => layers.includes(layer);
  const sleeveRows = look.top === "tee" ? 2 : 99;
  const arms = armPixels(pose, frame, g, sleeveRows);
  const legs = legPixels(pose, frame, g, back);

  if (has("body")) {
    for (const [x, y] of legs.trousers) grid.set(x, y, F.skinShade);
    for (const arm of arms) if (!arm.raised) grid.set(arm.x, arm.y, F.skin);
  }
  if (has("clothes")) {
    for (const [x, y, shade] of legs.trousers) grid.set(x, y, shade ? F.legsShade : F.legs);
    for (const [x, y] of legs.shoes) grid.set(x, y, F.shoes);
    paintTorso(grid, look, g, back);
    for (const arm of arms) {
      if (!arm.raised && arm.part === "sleeve")
        grid.set(arm.x, arm.y, arm.x > g.cx ? F.topShade : F.top);
    }
  }
  if (has("body")) paintHead(grid, hx, hy, back);
  if (has("hair")) (back ? paintHairBack : paintHairFront)(grid, look.hairStyle, hx, hy);
  if (has("accessory")) paintAccessory(grid, look, back, hx, hy, g);
  for (const arm of arms) {
    if (!arm.raised) continue;
    if (arm.part === "skin" && has("body")) grid.set(arm.x, arm.y, F.skin);
    if (arm.part === "sleeve" && has("clothes")) grid.set(arm.x, arm.y, F.top);
  }
  if (has("clothes")) paintProp(grid, pose, frame, g);
}

/** What a pose holds, over the figure: a mug, a paper cup, a phone, a book or a watering can. */
export function paintProp(grid: PixelGrid, pose: FigurePose, frame: number, g: FigureFrame): void {
  const shoulder = g.torsoTop + 1;
  const leftX = g.cx - g.half - 1;
  switch (pose) {
    case "stand-front-mug": {
      const x = g.cx + g.half + 1;
      grid.rect(x, g.torsoTop + 3, 2, 2, F.mug);
      grid.set(x + 2, g.torsoTop + 3, F.mug);
      break;
    }
    case "stand-front-cup": {
      // A paper cup: narrower at its foot, no handle.
      const x = g.cx + g.half + 1;
      grid.rect(x, g.torsoTop + 2, 2, 2, F.mug);
      grid.set(x, g.torsoTop + 4, F.mug);
      break;
    }
    case "sit-front-phone":
      grid.rect(g.cx - 1, shoulder + 2, 2, 2, F.device);
      grid.set(g.cx - 1, shoulder + 2, F.screen);
      break;
    case "stand-back-read":
      paintBook(grid, leftX - 4, shoulder, frame % 2 === 1);
      break;
    case "stand-back-water":
      paintWateringCan(grid, leftX - 1, g.torsoBottom - 1, frame % 2 === 1);
      break;
    default:
      break;
  }
}

/**
 * An open book held up, seen from behind its reader: its covers, the pages' edges over them; a
 * page turning stands up from the spine. `x` is its left edge, `y` its pages' top.
 */
function paintBook(grid: PixelGrid, x: number, y: number, turning: boolean): void {
  grid.set(x, y, F.mug);
  grid.set(x + 3, y, F.mug);
  grid.row(y + 1, x, x + 3, F.book);
  grid.row(y + 2, x + 1, x + 2, F.book);
  if (turning) {
    grid.set(x + 1, y - 1, F.mug);
    grid.set(x + 2, y, F.mug);
  }
}

/**
 * A watering can in the left hand, its spout towards the plant; tipped, the spout dips and a drop
 * or two falls. `handX` and `handY` are the hand on its handle.
 */
function paintWateringCan(grid: PixelGrid, handX: number, handY: number, tipped: boolean): void {
  const top = handY + 1;
  const tip = tipped ? 1 : 0;
  grid.rect(handX - 2, top + tip, 3, 3, F.can);
  for (let y = top + tip; y < top + tip + 3; y++) grid.set(handX, y, F.canShade);
  grid.set(handX - 1, handY + tip, F.canShade);
  // The spout: up and out while held, down towards the soil when tipped.
  grid.set(handX - 3, top + tip, F.can);
  grid.set(handX - 4, top + (tipped ? 2 : -1), F.can);
  if (tipped) {
    grid.set(handX - 4, top + 4, F.water);
    grid.set(handX - 5, top + 6, F.water);
  }
}

/** A head is 8 pixels square, from `cx - 4`. */
const HEAD_SIZE = 8;
const HEAD_HALF = HEAD_SIZE / 2;
/** Arms up in a jumping jack: pixels out from beside the head at the hands. */
const JACKS_REACH = 3;
/** Arms up in a stretch: the hands come in a pixel over the head. */
const STRETCH_REACH = -1;

/** One pixel of an arm: sleeve or skin, and whether it is the raised arm, drawn over the head. */
export interface ArmPixel {
  readonly x: number;
  readonly y: number;
  readonly part: "sleeve" | "skin";
  readonly raised?: boolean;
}

/** The arms, pixel by pixel. */
export function armPixels(
  pose: FigurePose,
  frame: number,
  g: FigureFrame,
  sleeveRows: number,
): ArmPixel[] {
  const pixels: ArmPixel[] = [];
  const leftX = g.cx - g.half - 1;
  const rightX = g.cx + g.half;
  const shoulder = g.torsoTop + 1;
  const column = (x: number, from: number, to: number, handX = x): void => {
    for (let y = from; y <= to; y++) {
      const isHand = y === to;
      pixels.push({
        x: isHand ? handX : x,
        y,
        part: !isHand && y - from < sleeveRows ? "sleeve" : "skin",
      });
    }
  };
  /**
   * An arm from the shoulder along `points`, its last pixel the hand; `inFront` draws the whole arm,
   * or only the hand, over the body and head.
   */
  const path = (
    points: readonly (readonly [number, number])[],
    inFront: "arm" | "hand" | null = null,
  ): void => {
    points.forEach(([x, y], i) => {
      const isHand = i === points.length - 1;
      const raised = inFront === "arm" || (inFront === "hand" && isHand);
      pixels.push({ x, y, part: !isHand && i < sleeveRows ? "sleeve" : "skin", raised });
    });
  };
  /** Both arms up from the shoulders to over the head, `reach` pixels out (or in, when negative) at the top. */
  const armsUp = (reach: number): void => {
    const top = g.headTop - 2;
    for (const [x, out] of [
      [leftX, -1],
      [rightX, 1],
    ] as const) {
      // Past the shoulder the arm goes up beside the head, never through it.
      const beside = out < 0 ? Math.min(x, g.cx - HEAD_HALF - 1) : Math.max(x, g.cx + HEAD_HALF);
      const points: [number, number][] = [[x, shoulder]];
      for (let y = shoulder - 1; y >= top; y--) {
        const up = (shoulder - y) / (shoulder - top);
        // Outwards, the arm leaves the shoulder at once; inwards, it bends only over the head.
        const offset = reach >= 0 ? Math.ceil(up * reach) : y < g.headTop ? reach : 0;
        points.push([beside + out * offset, y]);
      }
      path(points, "arm");
    }
  };
  const hangTo = g.torsoBottom - 1;
  switch (pose) {
    case "sit-back":
      column(leftX, shoulder, shoulder + 2, leftX - (frame % 2));
      column(rightX, shoulder, shoulder + 2, rightX - 1 + (frame % 2));
      break;
    case "sit-back-stretch":
      if (frame % 2) armsUp(STRETCH_REACH);
      else {
        column(leftX, shoulder, shoulder + 2, leftX);
        column(rightX, shoulder, shoulder + 2, rightX - 1);
      }
      break;
    case "stand-front-jacks":
      if (frame % 2) {
        column(leftX, shoulder, hangTo);
        column(rightX, shoulder, hangTo);
      } else armsUp(JACKS_REACH);
      break;
    case "stand-front-squat":
      if (frame % 2) {
        column(leftX, shoulder, hangTo);
        column(rightX, shoulder, hangTo);
      } else {
        // Arms out in front: the near one along the shoulder, the far one behind the body.
        path([
          [rightX, shoulder],
          [rightX + 1, shoulder],
          [rightX + 2, shoulder],
        ]);
        column(leftX, shoulder, shoulder + 1);
      }
      break;
    case "sit-front-phone":
      // Both hands at the phone, in front of the body.
      path(
        [
          [leftX, shoulder],
          [leftX, shoulder + 1],
          [leftX, shoulder + 2],
          [g.cx - 2, shoulder + 3],
        ],
        "hand",
      );
      path(
        [
          [rightX, shoulder],
          [rightX, shoulder + 1],
          [rightX, shoulder + 2],
          [g.cx + 1, shoulder + 3],
        ],
        "hand",
      );
      break;
    case "stand-back-read":
      column(leftX, shoulder, shoulder + 2, leftX - 1);
      column(rightX, shoulder, shoulder + 2, rightX - 1);
      break;
    case "stand-back-water":
      column(leftX, shoulder, hangTo, leftX - 1);
      column(rightX, shoulder, hangTo);
      break;
    case "sit-back-raise": {
      column(leftX, shoulder, shoulder + 2, leftX - 1);
      const wave = frame % 2;
      for (let y = g.headTop - 3; y <= shoulder + 1; y++) {
        const x = y < g.headTop ? rightX + wave : rightX;
        pixels.push({ x, y, part: y <= g.headTop - 2 ? "skin" : "sleeve", raised: true });
      }
      break;
    }
    case "sit-back-sleep":
      for (let x = g.cx - 7; x <= g.cx + 1; x++) {
        pixels.push({ x, y: g.torsoTop + 2, part: "sleeve" });
        pixels.push({ x, y: g.torsoTop + 3, part: "sleeve" });
      }
      break;
    case "sit-front":
      column(leftX, shoulder, shoulder + 3);
      if (frame % 2) column(rightX, shoulder, shoulder + 1, rightX + 1);
      else column(rightX, shoulder, shoulder + 3);
      break;
    case "stand-front-mug":
    case "stand-front-cup":
      column(leftX, shoulder, hangTo);
      column(rightX, shoulder, shoulder + 3);
      break;
    case "stand-back-talk":
      column(leftX, shoulder, hangTo);
      if (frame % 2) column(rightX, shoulder, shoulder + 1, rightX + 1);
      else column(rightX, shoulder, hangTo);
      break;
    default: {
      const swing = pose.startsWith("walk") ? frame % 4 : 0;
      column(leftX, shoulder, hangTo, leftX + (swing === 1 ? 1 : 0));
      column(rightX, shoulder, hangTo, rightX + (swing === 3 ? 1 : 0));
    }
  }
  return pixels;
}

/** The legs as `[x, y, shaded]` and the shoes as `[x, y]`. */
export interface LegPixels {
  readonly trousers: (readonly [x: number, y: number, shaded: boolean])[];
  readonly shoes: (readonly [x: number, y: number])[];
}

/** The legs and shoes; a seated back hides them behind the chair. */
export function legPixels(
  pose: FigurePose,
  frame: number,
  g: FigureFrame,
  back: boolean,
): LegPixels {
  const trousers: (readonly [number, number, boolean])[] = [];
  const shoes: (readonly [number, number])[] = [];
  const legHalf = g.half >= 5 ? 4 : 3;
  const left0 = g.cx - legHalf;
  const right1 = g.cx + legHalf - 1;
  if (g.seated && back) {
    for (let y = g.torsoBottom + 1; y <= g.torsoBottom + 2; y++) {
      for (let x = left0; x <= right1; x++) trousers.push([x, y, x >= g.cx]);
    }
    return { trousers, shoes };
  }
  // A squat bends the knees as a seat does, with nothing under it.
  if (g.seated || g.squat) {
    for (let y = g.torsoBottom + 1; y <= g.torsoBottom + 2; y++) {
      for (let x = left0; x <= right1 + 2; x++) trousers.push([x, y, y > g.torsoBottom + 1]);
    }
    for (let y = g.torsoBottom + 3; y < FIGURE.ground; y++) {
      for (let x = right1; x <= right1 + 2; x++) trousers.push([x, y, x === right1 + 2]);
    }
    for (let x = right1; x <= right1 + 3; x++) shoes.push([x, FIGURE.ground]);
    return { trousers, shoes };
  }
  const step = g.stride ? (frame === 1 ? 1 : -1) : 0;
  const legLength = FIGURE.ground - g.torsoBottom;
  for (let y = g.torsoBottom + 1; y < FIGURE.ground; y++) {
    const low = y >= FIGURE.ground - 2;
    // Feet apart, the legs slope out from the hips.
    const apart = Math.round((g.spread * (y - g.torsoBottom)) / legLength);
    const out = (low ? step : 0) + apart;
    for (let x = left0; x < g.cx; x++) trousers.push([x - out, y, false]);
    for (let x = g.cx; x <= right1; x++) trousers.push([x + out, y, true]);
  }
  const toe = back ? 0 : 1;
  const out = step + g.spread;
  for (let x = left0; x < g.cx + toe; x++) shoes.push([x - out, FIGURE.ground]);
  for (let x = g.cx; x <= right1 + toe; x++) shoes.push([x + out, FIGURE.ground]);
  return { trousers, shoes };
}

export function paintTorso(grid: PixelGrid, look: FigureLook, g: FigureFrame, back: boolean): void {
  const x0 = g.cx - g.half;
  const x1 = g.cx + g.half - 1;
  grid.rect(x0, g.torsoTop, x1 - x0 + 1, g.torsoBottom - g.torsoTop + 1, F.top);
  for (let y = g.torsoTop; y <= g.torsoBottom; y++) grid.set(x1, y, F.topShade);
  grid.row(g.torsoBottom, x0, x1, F.topShade);
  const c = g.cx;
  if (look.top === "tee" && !back) grid.row(g.torsoTop, c - 1, c, F.trim);
  if (look.top === "hoodie") {
    if (back) {
      grid.row(g.torsoTop, c - 3, c + 2, F.topShade);
      grid.row(g.torsoTop + 1, c - 2, c + 1, F.topShade);
    } else {
      grid.set(c - 2, g.torsoTop + 1, F.trim);
      grid.set(c - 2, g.torsoTop + 2, F.trim);
      grid.set(c + 1, g.torsoTop + 1, F.trim);
      grid.set(c + 1, g.torsoTop + 2, F.trim);
      grid.row(g.torsoBottom - 2, c - 2, c + 1, F.topShade);
    }
  }
  if (look.top === "jacket") {
    if (back) {
      for (let y = g.torsoTop + 2; y < g.torsoBottom; y++) grid.set(c - 1, y, F.topShade);
    } else {
      for (let y = g.torsoTop; y < g.torsoBottom; y++) grid.row(y, c - 1, c, F.trim);
      grid.set(c - 2, g.torsoTop, F.topShade);
      grid.set(c - 2, g.torsoTop + 1, F.topShade);
      grid.set(c + 1, g.torsoTop, F.topShade);
      grid.set(c + 1, g.torsoTop + 1, F.topShade);
    }
  }
}

export function paintHead(grid: PixelGrid, hx: number, hy: number, back: boolean): void {
  grid.rect(hx, hy, 8, 8, F.skin);
  for (const [x, y] of [
    [hx, hy],
    [hx + 7, hy],
    [hx, hy + 7],
    [hx + 7, hy + 7],
  ] as const) {
    grid.set(x, y, 0);
  }
  if (back) {
    grid.set(hx + 1, hy + 4, F.skinShade);
    return;
  }
  grid.set(hx + 4, hy + 4, F.eye);
  grid.set(hx + 6, hy + 4, F.eye);
  grid.set(hx + 1, hy + 4, F.skinShade);
  grid.set(hx + 5, hy + 6, F.skinShade);
}

/* Facing you, a figure looks down and to the right: its face on the right, the back of its head on the left. */
export function paintHairFront(grid: PixelGrid, style: HairStyle, hx: number, hy: number): void {
  const H = F.hair;
  const S = F.hairShade;
  const short = (): void => {
    grid.row(hy - 1, hx + 2, hx + 5, H);
    grid.row(hy, hx, hx + 7, H);
    grid.row(hy + 1, hx, hx + 7, H);
    grid.row(hy + 2, hx, hx + 2, H);
    grid.set(hx, hy + 3, H);
    grid.set(hx + 7, hy + 2, S);
  };
  switch (style) {
    case "buzz":
      grid.row(hy, hx + 1, hx + 6, S);
      grid.row(hy + 1, hx, hx + 7, S);
      grid.set(hx, hy + 2, S);
      break;
    case "short":
      short();
      break;
    case "swept":
      short();
      grid.row(hy + 2, hx + 3, hx + 6, H);
      grid.set(hx + 7, hy + 3, S);
      break;
    case "bob":
      short();
      grid.row(hy, hx - 1, hx + 8, H);
      for (let y = hy + 1; y <= hy + 7; y++) {
        grid.set(hx - 1, y, H);
        grid.set(hx, y, y > hy + 4 ? S : H);
      }
      for (let y = hy + 2; y <= hy + 5; y++) grid.set(hx + 7, y, S);
      break;
    case "long":
      short();
      for (let y = hy + 1; y <= hy + 12; y++) {
        grid.set(hx - 1, y, H);
        grid.set(hx, y, y > hy + 6 ? S : H);
      }
      for (let y = hy + 2; y <= hy + 6; y++) grid.set(hx + 7, y, S);
      break;
    case "bun":
      short();
      grid.row(hy - 4, hx + 2, hx + 4, H);
      grid.row(hy - 3, hx + 1, hx + 5, H);
      grid.row(hy - 2, hx + 2, hx + 4, S);
      break;
    case "curly":
      for (let y = hy - 2; y <= hy + 5; y++) {
        for (let x = hx - 1; x <= hx + 8; x++) {
          const dx = (x - (hx + 3.5)) / 5.2;
          const dy = (y - (hy + 1.5)) / 4.2;
          if (dx * dx + dy * dy > 1) continue;
          if (y >= hy + 2 && x >= hx + 2 && x <= hx + 7) continue;
          grid.set(x, y, (x + y) % 3 === 0 ? S : H);
        }
      }
      break;
    case "bald":
      break;
  }
}

/* From behind, a figure looks up and to the left: hair over the back of its head. */
export function paintHairBack(grid: PixelGrid, style: HairStyle, hx: number, hy: number): void {
  const H = F.hair;
  const S = F.hairShade;
  const cap = (rows: number, index: number = H): void => {
    grid.row(hy - 1, hx + 2, hx + 5, index);
    for (let y = hy; y < hy + rows; y++)
      grid.row(y, hx + (y === hy ? 1 : 0), hx + (y === hy ? 6 : 7), index);
  };
  switch (style) {
    case "buzz":
      for (let y = hy; y < hy + 6; y++)
        grid.row(y, hx + (y === hy ? 1 : 0), hx + (y === hy ? 6 : 7), S);
      break;
    case "short":
    case "swept":
      cap(6);
      grid.row(hy + 6, hx + 1, hx + 6, S);
      break;
    case "bob":
      cap(8);
      for (let y = hy + 1; y <= hy + 7; y++) {
        grid.set(hx - 1, y, H);
        grid.set(hx + 8, y, S);
      }
      break;
    case "long":
      cap(8);
      for (let y = hy + 1; y <= hy + 12; y++) {
        grid.set(hx - 1, y, H);
        grid.set(hx + 8, y, S);
      }
      for (let y = hy + 8; y <= hy + 12; y++) grid.row(y, hx, hx + 7, y > hy + 10 ? S : H);
      break;
    case "bun":
      cap(6);
      grid.row(hy - 4, hx + 3, hx + 5, H);
      grid.row(hy - 3, hx + 2, hx + 6, H);
      grid.row(hy - 2, hx + 3, hx + 5, S);
      break;
    case "curly":
      for (let y = hy - 2; y <= hy + 6; y++) {
        for (let x = hx - 1; x <= hx + 8; x++) {
          const dx = (x - (hx + 3.5)) / 5.2;
          const dy = (y - (hy + 2)) / 5;
          if (dx * dx + dy * dy <= 1) grid.set(x, y, (x + y) % 3 === 0 ? S : H);
        }
      }
      break;
    case "bald":
      break;
  }
}

export function paintAccessory(
  grid: PixelGrid,
  look: FigureLook,
  back: boolean,
  hx: number,
  hy: number,
  g: FigureFrame,
): void {
  const E = F.extra;
  const L = F.extraLight;
  switch (look.accessory) {
    case "glasses":
      if (back) {
        grid.set(hx, hy + 4, E);
        break;
      }
      grid.set(hx + 3, hy + 4, E);
      grid.set(hx + 5, hy + 4, E);
      grid.set(hx + 7, hy + 4, E);
      grid.set(hx + 4, hy + 3, E);
      grid.set(hx + 6, hy + 3, E);
      grid.set(hx + 4, hy + 4, L);
      grid.set(hx + 6, hy + 4, L);
      grid.set(hx + 2, hy + 4, E);
      break;
    case "headphones":
      grid.row(hy - 1, hx + 1, hx + 6, E);
      grid.set(hx, hy, E);
      grid.set(hx + 7, hy, E);
      grid.rect(hx - 1, hy + 3, 2, 3, E);
      grid.set(hx, hy + 4, L);
      if (back) {
        grid.rect(hx + 7, hy + 3, 2, 3, E);
        grid.set(hx + 7, hy + 4, L);
      }
      break;
    case "beard":
      if (back) {
        for (let y = hy + 5; y <= hy + 7; y++) grid.set(hx, y, E);
        break;
      }
      grid.row(hy + 5, hx + 3, hx + 4, E);
      grid.row(hy + 6, hx + 2, hx + 7, E);
      grid.row(hy + 7, hx + 3, hx + 6, E);
      grid.set(hx + 6, hy + 5, E);
      break;
    case "scarf":
      grid.row(g.torsoTop, g.cx - g.half, g.cx + g.half - 1, E);
      grid.row(g.torsoTop + 1, g.cx - g.half, g.cx + g.half - 1, E);
      grid.set(back ? g.cx - 2 : g.cx + 1, g.torsoTop + 2, L);
      grid.set(back ? g.cx - 2 : g.cx + 1, g.torsoTop + 3, L);
      break;
    case "none":
      break;
  }
}

/** A push-up's shoulders off the floor, in pixels: frame 0 arms straight, frame 1 bent. */
const PUSH_UP_SHOULDERS = [6, 2] as const;
/** How far a lying figure's head and hair reach past its shoulders, in columns. */
const LYING_HEAD_REACH = 7;
/** A lying figure's legs, from the side: rows thick. */
const LYING_LEG_ROWS = 3;
/** A lying figure's shoes: columns long, standing on their toes. */
const LYING_SHOE_COLUMNS = 2;
/** The head's top, over the torso's at the shoulders. */
const LYING_HEAD_OVER_TORSO = 2;
/** The head stays this many rows clear of the floor under its front. */
const LYING_HEAD_CLEARANCE = 2;

/**
 * A figure lying face down along the floor's y axis, seen from its side: on screen the floor's y
 * runs two pixels left for each one down, so the head is up and to the right, the feet down and
 * to the left. The body is a plank from the toes to the shoulders, held up by the near arm; the
 * standing figure's rows (torso, legs) become its length in columns.
 */
function paintLying(
  grid: PixelGrid,
  look: FigureLook,
  frame: number,
  g: FigureFrame,
  layers: readonly FigureLayer[],
): void {
  const has = (layer: FigureLayer): boolean => layers.includes(layer);
  const { anchorX, anchorY } = LYING_FIGURE;
  const torsoColumns = g.torsoBottom - g.torsoTop + 1;
  const legColumns = g.legRows + LYING_SHOE_COLUMNS;
  const toes = anchorX - Math.floor((torsoColumns + legColumns + LYING_HEAD_REACH) / 2);
  const shoulders = toes + torsoColumns + legColumns - 1;
  const hips = shoulders - torsoColumns + 1;
  const lift = PUSH_UP_SHOULDERS[frame % 2] ?? 0;
  const thickness = g.half + 1;
  const floorAt = (x: number): number => anchorY + Math.round((anchorX - x) / 2);
  /** The body's underside: on the floor at the toes, `lift` up at the shoulders. */
  const under = (x: number): number =>
    floorAt(x) - Math.round((lift * (x - toes)) / (shoulders - toes));
  const torsoTopAt = (x: number): number => under(x) - thickness + 1;

  for (let x = toes; x <= shoulders; x++) {
    const bottom = under(x);
    if (x < toes + LYING_SHOE_COLUMNS) {
      if (has("clothes"))
        for (let y = bottom - LYING_LEG_ROWS + 1; y <= bottom; y++) grid.set(x, y, F.shoes);
    } else if (x < hips) {
      for (let y = bottom - LYING_LEG_ROWS + 1; y <= bottom; y++) {
        if (has("clothes")) grid.set(x, y, y === bottom ? F.legsShade : F.legs);
        else if (has("body")) grid.set(x, y, F.skinShade);
      }
    } else if (has("clothes")) {
      for (let y = torsoTopAt(x); y <= bottom; y++)
        grid.set(x, y, y === bottom ? F.topShade : F.top);
      if (look.top === "jacket") grid.set(x, bottom - 1, F.trim);
    }
  }
  if (has("clothes") && look.top === "hoodie") {
    grid.set(shoulders - 1, torsoTopAt(shoulders - 1) - 1, F.topShade);
    grid.set(shoulders - 2, torsoTopAt(shoulders - 2) - 1, F.topShade);
  }

  // A tee's sleeve covers the arm's first pixels only.
  const sleeveRows = look.top === "tee" ? 2 : 99;
  for (const arm of lyingArm(frame, shoulders - 1, sleeveRows, torsoTopAt, floorAt)) {
    // The sleeve over the body, a shade darker so the arm shows against it.
    if (arm.part === "sleeve" && has("clothes")) grid.set(arm.x, arm.y, F.topShade);
    if (arm.part === "skin" && has("body")) grid.set(arm.x, arm.y, F.skin);
  }

  const hx = shoulders - 1;
  const hy = Math.min(
    torsoTopAt(shoulders) - LYING_HEAD_OVER_TORSO,
    floorAt(hx + HEAD_SIZE - 1) - HEAD_SIZE - LYING_HEAD_CLEARANCE,
  );
  if (has("body")) paintHead(grid, hx, hy, true);
  // Face down, long hair falls no further than a bob's.
  if (has("hair")) paintHairBack(grid, look.hairStyle === "long" ? "bob" : look.hairStyle, hx, hy);
  if (has("accessory")) {
    if (look.accessory === "scarf") {
      for (let x = shoulders - 1; x <= shoulders; x++) {
        for (let y = torsoTopAt(x); y < under(x); y++) grid.set(x, y, F.extra);
      }
      grid.set(shoulders - 2, under(shoulders - 2), F.extraLight);
    } else paintAccessory(grid, look, true, hx, hy, g);
  }
}

/** A lying figure's near arm, pixel by pixel from the shoulder: its sleeve, then skin to the hand. */
function lyingArm(
  frame: number,
  shoulder: number,
  sleeveRows: number,
  torsoTopAt: (x: number) => number,
  floorAt: (x: number) => number,
): ArmPixel[] {
  const points: [number, number][] = [];
  if (frame % 2 === 0) {
    // Straight down from the shoulder to the hand flat on the floor.
    for (let y = torsoTopAt(shoulder) + 1; y <= floorAt(shoulder); y++) points.push([shoulder, y]);
    points.push([shoulder + 1, floorAt(shoulder)]);
  } else {
    // Bent: the elbow up behind the shoulder, the forearm down to the hand under the chest.
    const elbow = shoulder - 2;
    points.push([shoulder - 1, torsoTopAt(shoulder - 1)], [elbow, torsoTopAt(elbow) - 1]);
    for (let y = torsoTopAt(elbow); y <= floorAt(elbow); y++) points.push([elbow, y]);
    points.push([elbow + 1, floorAt(elbow)]);
  }
  // The hand is the last two pixels, flat on the floor.
  const handFrom = points.length - 2;
  return points.map(([x, y], index) => ({
    x,
    y,
    part: index >= handFrom || index >= sleeveRows ? "skin" : "sleeve",
  }));
}

/** A figure in a pose and frame, outlined, its feet's middle (a lying figure's, its body's) on the anchor. */
export function figureShape(
  look: FigureLook,
  pose: FigurePose,
  frame: number,
  layers: readonly FigureLayer[] = LAYERS,
): ArtShape {
  const size = figureGridOf(pose);
  const grid = new PixelGrid(size.width, size.height);
  paintFigure(grid, look, pose, frame, layers);
  grid.outline(F.outline);
  return { grid, anchorX: size.anchorX, anchorY: size.anchorY };
}

const figurePalettes = new Map<string, (number | null)[]>();

/** A person's figure in a pose, painted: shape by their Role key's look, colours by it and their Avatar tint. */
export function paintedFigure(
  roleKey: string,
  tone: AvatarTone,
  pose: FigurePose,
  frame: number,
  layers: readonly FigureLayer[] = LAYERS,
): PaintedArt {
  const look = lookOf(roleKey);
  const paletteKey = figurePaletteKey(look, tone);
  let palette = figurePalettes.get(paletteKey);
  if (!palette) {
    palette = figureColors(look, tone);
    figurePalettes.set(paletteKey, palette);
  }
  return paintedArt(
    figureShapeKey(look, pose, frame, layers),
    () => figureShape(look, pose, frame, layers),
    paletteKey,
    palette,
  );
}
