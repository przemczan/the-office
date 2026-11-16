import type { FigurePose, HeadGlance } from "../live-view-types.ts";
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
  mugShade: 22,
  coffee: 23,
  cupShade: 24,
} as const;

/**
 * What a pastime holds, the same for everyone: the mug and the paper cup (both `mug` white), the
 * phone or the game controller, the book and the watering can.
 */
const PROP_COLOURS = {
  device: 0x2b2e35,
  screen: 0x9fd6ff,
  book: 0xc8102e,
  can: 0x4f9b59,
  canShade: 0x3a7a45,
  water: 0x8fc9f2,
  mugShade: 0xc4bcae,
  coffee: 0x4a2a17,
  cupShade: 0xcfd8e2,
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
  glance: HeadGlance = "ahead",
  layers: readonly FigureLayer[] = LAYERS,
): string =>
  `fig:${look.build}.${look.tall ? 1 : 0}.${look.hairStyle}.${look.top}.${look.accessory}:${pose}:${frame}:${glance}:${layers.join("+")}`;

/**
 * A figure lying along the floor's y axis (a push-up): its head up and to the right, its feet down
 * and to the left, its anchor the middle of the body on the floor. Wider than a standing figure's
 * grid, its anchor higher up it.
 */
export const LYING_FIGURE = { width: 36, height: 34, anchorX: 16, anchorY: 25 } as const;

/** Room on the left for what a figure holds out there: the open book. */
const PROP_ROOM = 4;
/** Room on the left for the watering can, held out over the plant's pot (`WATERING_DROP`). */
const WATERING_ROOM = 5;

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
const WATERING_GRID: FigureGrid = {
  ...FIGURE,
  width: FIGURE.width + WATERING_ROOM,
  anchorX: FIGURE.anchorX + WATERING_ROOM,
  centre: FIGURE.centre + WATERING_ROOM,
};
const LYING_GRID: FigureGrid = { ...LYING_FIGURE, centre: LYING_FIGURE.anchorX };

export const isLying = (pose: FigurePose): boolean => pose.startsWith("lie");

export function figureGridOf(pose: FigurePose): FigureGrid {
  if (isLying(pose)) return LYING_GRID;
  if (pose === "stand-back-water") return WATERING_GRID;
  return pose === "stand-back-read" ? PROP_GRID : STANDING_GRID;
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
  // From its anchor (the body's middle): further on the right, where the head is, than on the left,
  // where the toes are. The mat's spots never mirror it.
  lying: { left: -12, right: 14, top: -20, bottom: 7, head: 16 },
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
  /** Down in a squat: the feet where a standing figure's are, the knees bent out, the torso lower. */
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
/** How far above the ground a seated figure's torso ends. */
const SEATED_TORSO_ABOVE_GROUND = 4;
/**
 * How far above the ground a squatting figure's torso ends: a row higher than a seated one's, as
 * nothing holds it up, leaving four rows for the thighs, the knees and the shins (`SQUAT_LEG`).
 */
const SQUAT_TORSO_ABOVE_GROUND = 5;
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
  const torsoBottom = seated
    ? FIGURE.ground - SEATED_TORSO_ABOVE_GROUND
    : squat
      ? FIGURE.ground - SQUAT_TORSO_ABOVE_GROUND
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

/** How far a glance turns the head: a pixel to that side of the grid. */
const GLANCE_TURN: Readonly<Record<HeadGlance, number>> = { ahead: 0, left: -1, right: 1 };
/**
 * Paints one figure. `glance` turns a still figure's head a pixel to that side of its grid (so a
 * mirrored figure's "left" is the screen's right); walking, asleep or lying it looks ahead, and
 * playing it looks at the TV. `layers` lets a sheet show body, clothes, hair and accessory one by one.
 */
export function paintFigure(
  grid: PixelGrid,
  look: FigureLook,
  pose: FigurePose,
  frame: number,
  glance: HeadGlance = "ahead",
  layers: readonly FigureLayer[] = LAYERS,
): void {
  const g = figureFrame(look, pose, frame);
  if (g.lying) {
    paintLying(grid, look, frame, g, layers);
    return;
  }
  if (pose === "sit-back-play") {
    paintPlaying(grid, look, frame, g, layers);
    return;
  }
  const back = pose.includes("back");
  const sleep = pose === "sit-back-sleep";
  const breathe = sleep ? frame % 2 : 0;
  // Looking down at the phone: the head nods a pixel.
  const nod = pose === "sit-front-phone" ? 1 : 0;
  const turn = sleep || pose.startsWith("walk") ? 0 : GLANCE_TURN[glance];
  const hx = g.cx - 4 + (sleep ? -3 : 0) + turn;
  const hy = g.headTop + (sleep ? 3 + breathe : nod);
  const has = (layer: FigureLayer): boolean => layers.includes(layer);
  const sleeveRows = look.top === "tee" ? 2 : 99;
  const arms = armPixels(pose, frame, g, sleeveRows);
  const legs = legPixels(frame, g, back);
  const overTorso = (x: number, y: number): boolean =>
    x >= g.cx - g.half && x < g.cx + g.half && y >= g.torsoTop && y <= g.torsoBottom;

  if (has("body")) {
    for (const leg of legs) for (const [x, y] of leg.trousers) grid.set(x, y, F.skinShade);
    for (const arm of arms) if (!arm.raised) grid.set(arm.x, arm.y, F.skin);
  }
  if (has("clothes")) {
    for (const leg of legs) {
      for (const [x, y, shade] of leg.trousers) grid.set(x, y, shade ? F.legsShade : F.legs);
      for (const [x, y] of leg.shoes) grid.set(x, y, F.shoes);
    }
    paintTorso(grid, look, g, back);
    for (const arm of arms) {
      if (!arm.raised && arm.part === "sleeve")
        grid.set(arm.x, arm.y, arm.x > g.cx ? F.topShade : F.top);
    }
  }
  if (has("body")) paintHead(grid, hx, hy, back, turn);
  if (has("hair")) (back ? paintHairBack : paintHairFront)(grid, look.hairStyle, hx, hy);
  if (has("body")) paintGlanceEdge(grid, hx, hy, back, turn);
  if (has("accessory")) paintAccessory(grid, look, back, hx, hy, g, turn);
  // Panicking, the mouth is open.
  if (has("body") && pose === "stand-front-panic")
    grid.set(hx + 5 + faceShiftOf(turn), hy + 6, F.eye);
  for (const arm of arms) {
    if (!arm.raised) continue;
    if (arm.part === "skin" && has("body")) grid.set(arm.x, arm.y, F.skin);
    // An arm across the body takes the shade, so it shows against the top.
    if (arm.part === "sleeve" && has("clothes"))
      grid.set(arm.x, arm.y, overTorso(arm.x, arm.y) ? F.topShade : F.top);
  }
  if (has("clothes")) paintProp(grid, pose, frame, g, turn);
}

/**
 * What a pose holds, over the figure: a mug, a paper cup (at the waist or at the mouth, the head
 * turned `turn` pixels), a phone, a game controller, a book or a watering can.
 */
export function paintProp(
  grid: PixelGrid,
  pose: FigurePose,
  frame: number,
  g: FigureFrame,
  turn = 0,
): void {
  const shoulder = g.torsoTop + 1;
  const leftX = g.cx - g.half - 1;
  const rightX = g.cx + g.half;
  // At the mouth, the cup's left edge is against the face's right, two pixels right of the middle.
  const atMouth = g.cx + 2 + turn + faceShiftOf(turn);
  switch (pose) {
    case "stand-front-mug":
      paintMug(grid, rightX - 1, shoulder + 2);
      break;
    case "stand-front-cup":
      paintPaperCup(grid, rightX - 1, shoulder + 2);
      break;
    case "stand-front-mug-sip":
      // Tipped to the lips: its side, the coffee at the rim by the mouth, the handle out.
      grid.rect(atMouth, shoulder - 4, 3, 3, F.mug);
      grid.row(shoulder - 2, atMouth, atMouth + 2, F.mugShade);
      grid.set(atMouth, shoulder - 4, F.coffee);
      grid.set(atMouth + 3, shoulder - 3, F.mugShade);
      break;
    case "stand-front-cup-sip":
      // Tipped to the lips: wide at the rim by the mouth, narrow at its foot.
      grid.rect(atMouth, shoulder - 4, 3, 2, F.mug);
      grid.set(atMouth, shoulder - 4, F.water);
      grid.set(atMouth + 2, shoulder - 3, F.cupShade);
      grid.row(shoulder - 2, atMouth + 1, atMouth + 2, F.cupShade);
      break;
    case "sit-front-phone":
      grid.rect(g.cx - 1, shoulder + 2, 2, 2, F.device);
      grid.set(g.cx - 1, shoulder + 2, F.screen);
      break;
    case "stand-back-read":
      paintBook(grid, leftX - 4, shoulder, frame % 2 === 1);
      break;
    case "stand-back-water":
      paintWateringCan(
        grid,
        g.cx + WATERING_DROP.x,
        FIGURE.anchorY + WATERING_DROP.y,
        frame % 2 === 1,
      );
      break;
    default:
      break;
  }
}

/** A mug from the front, a little from above: the coffee inside its rim, the handle on the right. */
function paintMug(grid: PixelGrid, x: number, y: number): void {
  grid.rect(x, y, 4, 4, F.mug);
  grid.row(y, x + 1, x + 2, F.coffee);
  for (let row = y + 1; row <= y + 3; row++) grid.set(x + 3, row, F.mugShade);
  grid.row(y + 3, x, x + 3, F.mugShade);
  grid.set(x + 4, y + 1, F.mugShade);
  grid.set(x + 4, y + 2, F.mugShade);
}

/** A paper cup from the front, a little from above: water inside its rim, tapering to its foot. */
function paintPaperCup(grid: PixelGrid, x: number, y: number): void {
  grid.rect(x, y, 4, 2, F.mug);
  grid.row(y, x + 1, x + 2, F.water);
  grid.set(x + 3, y + 1, F.cupShade);
  grid.set(x + 1, y + 2, F.mug);
  grid.set(x + 2, y + 2, F.cupShade);
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
 * Where the watering can's water lands, from the anchor of a figure watering (unmirrored, the plant
 * on its left): its lowest drop. The plant's spot (`floor-plan.ts`, `facingTheWall`) is 0.8 tiles
 * in front of the plant, 12 to 13 pixels to the side of it and 6 to 7 up, so a tall plant's pot top
 * (`plantShape`, 9 high) is 13 pixels to the side and 14 to 17 up, over the shoulders: the can is
 * held up beside the head and the drops land in the pot. A short plant's pot is 3 pixels lower,
 * and over it they are still falling.
 */
export const WATERING_DROP = { x: -13, y: -14 } as const;

/**
 * A watering can held up beside the head, its spout towards the plant; tipped, the spout dips and
 * the water falls, its lowest drop on (`dropX`, `dropY`). The hand is on its handle
 * (`wateringHand`).
 */
function paintWateringCan(grid: PixelGrid, dropX: number, dropY: number, tipped: boolean): void {
  const bodyX = dropX + 3;
  const bodyY = dropY - 3;
  grid.rect(bodyX, bodyY, 4, 3, F.can);
  for (let y = bodyY; y < bodyY + 3; y++) grid.set(bodyX + 3, y, F.canShade);
  grid.row(bodyY - 1, bodyX + 1, bodyX + 2, F.canShade);
  // The spout: from the can's foot, up and out while held, levelled when tipped.
  grid.set(dropX + 2, dropY - 2, F.can);
  grid.set(dropX + 1, dropY - 3, F.can);
  grid.set(dropX, tipped ? dropY - 3 : dropY - 4, F.canShade);
  if (tipped) {
    grid.set(dropX, dropY - 1, F.water);
    grid.set(dropX, dropY, F.water);
  }
}

/** The hand on the watering can's handle, from the lowest drop: up and to the right of the can. */
const wateringHand = (dropX: number, dropY: number): readonly [number, number] => [
  dropX + 6,
  dropY - 4,
];

/** The pixels of a straight line from `from` to `to`, both included. */
function line(from: readonly [number, number], to: readonly [number, number]): [number, number][] {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = steps === 0 ? 0 : i / steps;
    return [
      Math.round(from[0] + (to[0] - from[0]) * t),
      Math.round(from[1] + (to[1] - from[1]) * t),
    ];
  });
}

/** A head is 8 pixels square, from `cx - 4`. */
const HEAD_SIZE = 8;
const HEAD_HALF = HEAD_SIZE / 2;
/** Arms up in a jumping jack: pixels out from beside the head at the hands. */
const JACKS_REACH = 3;
/** Arms up in a stretch: the hands come in a pixel over the head. */
const STRETCH_REACH = -1;
/**
 * Arms waving in a panic, as long as a hanging arm: from the shoulder out to the elbow, then the
 * forearm straight up beside the head, `PANIC_FOREARM_OUT` pixels out, to the hand `PANIC_HAND_UP`
 * rows over the shoulder: at the eyes, or a row higher, the two arms swapping each frame.
 */
const PANIC_ELBOW = [
  [0, 0],
  [1, -1],
  [2, -2],
] as const;
const PANIC_FOREARM_OUT = 2;
const PANIC_HAND_UP = [5, 6] as const;
/** How far over the head's top arms raised in a jumping jack or a stretch reach. */
const RAISED_OVER_HEAD = 2;

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
  /**
   * Both arms up from the shoulders to over the head's top, `reach` pixels out (or in, when
   * negative) at the top.
   */
  const armsUp = (reach: number): void => {
    const top = g.headTop - RAISED_OVER_HEAD;
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
        // Arms out in front for balance, towards us: foreshortened, the hands in front of the chest.
        path(
          [
            [leftX, shoulder],
            [leftX + 1, shoulder + 1],
            [leftX + 2, shoulder + 1],
          ],
          "arm",
        );
        path(
          [
            [rightX, shoulder],
            [rightX - 1, shoulder + 1],
            [rightX - 2, shoulder + 1],
          ],
          "arm",
        );
      }
      break;
    case "stand-front-panic":
      // Waving beside the head, one hand a row higher than the other, then the other way.
      for (const [x, out, side] of [
        [leftX, -1, 0],
        [rightX, 1, 1],
      ] as const) {
        const handUp = PANIC_HAND_UP[(frame + side) % 2] ?? 0;
        const points: [number, number][] = PANIC_ELBOW.map(([dx, dy]) => [
          x + out * dx,
          shoulder + dy,
        ]);
        const forearmX = x + out * PANIC_FOREARM_OUT;
        for (let up = PANIC_ELBOW.length; up <= handUp; up++)
          points.push([forearmX, shoulder - up]);
        path(points, "arm");
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
      // Reaching up and out to the can's handle, over the hair.
      path(
        line(
          [leftX, shoulder],
          wateringHand(g.cx + WATERING_DROP.x, FIGURE.anchorY + WATERING_DROP.y),
        ),
        "arm",
      );
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
    case "stand-front-mug-sip":
    case "stand-front-cup-sip":
      // The elbow out and down, the forearm up, the hand under the cup at the mouth (`paintProp`).
      column(leftX, shoulder, hangTo);
      path(
        [
          [rightX, shoulder],
          [rightX + 1, shoulder + 1],
          [rightX + 1, shoulder],
          [rightX + 1, shoulder - 1],
          [g.cx + 5, shoulder - 2],
        ],
        "hand",
      );
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

/** One leg: its trousers as `[x, y, shaded]` and its shoe as `[x, y]`. */
export interface LegPixels {
  readonly trousers: (readonly [x: number, y: number, shaded: boolean])[];
  readonly shoes: (readonly [x: number, y: number])[];
}

/** The legs, the one on the grid's left first. */
export type Legs = readonly [left: LegPixels, right: LegPixels];

/** A leg's width, in pixels: a broad build's legs are a pixel wider. */
const legWidthOf = (half: number): number => (half >= 5 ? 4 : 3);

/**
 * A squat's legs, row by row from the hips to the ankles: how many pixels each leg's outer edge
 * goes out, and its inner edge in, from where a standing leg's are. The thighs go out to the knees,
 * the widest row, and the shins come back in over the feet.
 */
const SQUAT_LEG = [
  [0, 0],
  [1, 1],
  [2, 1],
  [1, 0],
] as const;

/**
 * The legs and shoes. Seated, they go side by side with a column between them, so they never read
 * as crossed; from behind, a chair hides all but the thighs.
 */
export function legPixels(frame: number, g: FigureFrame, back: boolean): Legs {
  const left: LegPixels = { trousers: [], shoes: [] };
  const right: LegPixels = { trousers: [], shoes: [] };
  const width = legWidthOf(g.half);
  const left0 = g.cx - width;
  const right1 = g.cx + width - 1;
  if (g.seated) {
    for (let y = g.torsoBottom + 1; y <= g.torsoBottom + 2; y++) {
      const shaded = back ? false : y > g.torsoBottom + 1;
      for (let x = g.cx - width; x < g.cx; x++) left.trousers.push([x, y, shaded]);
      for (let x = g.cx + 1; x <= g.cx + width; x++) right.trousers.push([x, y, back || shaded]);
    }
    if (back) return [left, right];
    for (let y = g.torsoBottom + 3; y < FIGURE.ground; y++) {
      for (let x = g.cx - width; x < g.cx; x++) left.trousers.push([x, y, false]);
      for (let x = g.cx + 1; x <= g.cx + width; x++) right.trousers.push([x, y, true]);
    }
    for (let x = g.cx - width; x < g.cx; x++) left.shoes.push([x, FIGURE.ground]);
    for (let x = g.cx + 1; x <= g.cx + width; x++) right.shoes.push([x, FIGURE.ground]);
    return [left, right];
  }
  const step = g.stride ? (frame === 1 ? 1 : -1) : 0;
  const legLength = FIGURE.ground - g.torsoBottom;
  for (let y = g.torsoBottom + 1; y < FIGURE.ground; y++) {
    if (g.squat) {
      const [out, inward] = SQUAT_LEG[y - g.torsoBottom - 1] ?? [0, 0];
      // The shins take the shade, under the knees.
      const shin = y === FIGURE.ground - 1;
      for (let x = left0 - out; x < g.cx - inward; x++) left.trousers.push([x, y, shin]);
      for (let x = g.cx + inward; x <= right1 + out; x++) right.trousers.push([x, y, true]);
      continue;
    }
    const low = y >= FIGURE.ground - 2;
    // Feet apart, the legs slope out from the hips.
    const apart = Math.round((g.spread * (y - g.torsoBottom)) / legLength);
    const out = (low ? step : 0) + apart;
    for (let x = left0; x < g.cx; x++) left.trousers.push([x - out, y, false]);
    for (let x = g.cx; x <= right1; x++) right.trousers.push([x + out, y, true]);
  }
  // A squat's feet stay flat where a standing figure's are.
  const toe = back ? 0 : 1;
  const out = step + g.spread;
  for (let x = left0; x < g.cx + toe; x++) left.shoes.push([x - out, FIGURE.ground]);
  for (let x = g.cx; x <= right1 + toe; x++) right.shoes.push([x + out, FIGURE.ground]);
  return [left, right];
}

/** The torso, its right column in the shade, for the light from the left. */
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

/**
 * How far a glance's `turn` moves the face on the head: the face sits a pixel right of the head's
 * middle, so a turn left moves it two to read as one.
 */
const faceShiftOf = (turn: number): number => (turn < 0 ? -2 : turn);

/** A head; `turn` (-1, 0 or 1) moves the face to that side, as a glance does. */
export function paintHead(grid: PixelGrid, hx: number, hy: number, back: boolean, turn = 0): void {
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
  const face = faceShiftOf(turn);
  grid.set(hx + 4 + face, hy + 4, F.eye);
  grid.set(hx + 6 + face, hy + 4, F.eye);
  // The ear is on the side the face turned away from.
  grid.set(turn < 0 ? hx + 6 : hx + 1, hy + 4, F.skinShade);
  grid.set(hx + 5 + face, hy + 6, F.skinShade);
}

/**
 * A glance's profile, over the hair: facing us, the nose shows past the head's edge on the side it
 * turned to; from behind, the cheek and the nose show there.
 */
function paintGlanceEdge(
  grid: PixelGrid,
  hx: number,
  hy: number,
  back: boolean,
  turn: number,
): void {
  if (turn === 0) return;
  const edge = turn > 0 ? hx + HEAD_SIZE - 1 : hx;
  if (back) {
    grid.set(edge, hy + 5, F.skin);
    grid.set(edge, hy + 6, F.skinShade);
    grid.set(edge + turn, hy + 5, F.skin);
  } else grid.set(edge + turn, hy + 5, F.skin);
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
  turn = 0,
): void {
  const E = F.extra;
  const L = F.extraLight;
  // What is on the face moves with a glance's turn.
  const fx = hx + faceShiftOf(turn);
  switch (look.accessory) {
    case "glasses":
      if (back) {
        grid.set(hx, hy + 4, E);
        break;
      }
      grid.set(fx + 3, hy + 4, E);
      grid.set(fx + 5, hy + 4, E);
      grid.set(fx + 7, hy + 4, E);
      grid.set(fx + 4, hy + 3, E);
      grid.set(fx + 6, hy + 3, E);
      grid.set(fx + 4, hy + 4, L);
      grid.set(fx + 6, hy + 4, L);
      grid.set(fx + 2, hy + 4, E);
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
      grid.row(hy + 5, fx + 3, fx + 4, E);
      grid.row(hy + 6, fx + 2, fx + 7, E);
      grid.row(hy + 7, fx + 3, fx + 6, E);
      grid.set(fx + 6, hy + 5, E);
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

/** A player's hips over the ground, sitting on a floor pillow: a row lower than on a chair. */
const PILLOW_SEAT = 3;
/** A player's knee, up in front, in pixels from the body's middle: its front column. */
const PLAY_KNEE = -6;
/** How far a player's head leans in past the chest, towards the TV, in pixels. */
const PLAY_LEAN = 2;

/**
 * A player on a floor pillow, in profile facing the grid's left, a little from behind: the seat
 * mirrors it, so it faces the TV, up and to the right on screen. A back view alone reads the same
 * either way round (as facing up the screen), so the direction shows in what a profile has: the
 * face on the leading side (an eye, the nose past the head's edge), the ear and the hair behind,
 * the head leaning in (`PLAY_LEAN`), the near knee up in front (`PLAY_KNEE`) with the shin down to
 * a shoe, and both hands forward on the controller, the thumbs working from frame to frame.
 */
function paintPlaying(
  grid: PixelGrid,
  look: FigureLook,
  frame: number,
  g: FigureFrame,
  layers: readonly FigureLayer[],
): void {
  const has = (layer: FigureLayer): boolean => layers.includes(layer);
  const bottom = FIGURE.ground - PILLOW_SEAT;
  const top = bottom - (g.torsoBottom - g.torsoTop);
  // Turned, the back is a pixel narrower than straight from behind, and a pixel to the right, so
  // the body sits on the pillow's middle with the legs out in front.
  const x0 = g.cx - g.half + 2;
  const x1 = g.cx + g.half;
  const hx = x0 - PLAY_LEAN;
  const hy = top - HEAD_SIZE;
  const thumbs = frame % 2;

  if (has("clothes")) {
    const knee = g.cx + PLAY_KNEE;
    // The thigh rises from the hips to the knee, the shin drops from it to the shoe.
    grid.row(bottom - 3, knee + 1, knee + 3, F.legs);
    grid.row(bottom - 2, knee, g.cx + 1, F.legs);
    grid.row(bottom - 1, knee, g.cx + 1, F.legs);
    grid.row(bottom, knee, g.cx + 1, F.legsShade);
    for (let y = bottom + 1; y < FIGURE.ground; y++) grid.row(y, knee, knee + 1, F.legsShade);
    grid.row(FIGURE.ground, knee - 1, knee + 1, F.shoes);
    // The seat on the pillow, under the torso.
    grid.row(bottom + 1, x0, x1 - 1, F.legsShade);

    grid.rect(x0, top, x1 - x0 + 1, bottom - top + 1, F.top);
    for (let y = top; y <= bottom; y++) grid.set(x1, y, F.topShade);
    grid.row(bottom, x0, x1, F.topShade);
    // A hood or a jacket's seam on the back, behind the shoulders.
    if (look.top === "hoodie") {
      grid.row(top, x1 - 4, x1 - 1, F.topShade);
      grid.row(top + 1, x1 - 3, x1 - 1, F.topShade);
    }
    if (look.top === "jacket")
      for (let y = top + 2; y < bottom; y++) grid.set(x1 - 2, y, F.topShade);
  }

  if (has("body")) paintHead(grid, hx, hy, true);
  if (has("hair")) paintHairBack(grid, look.hairStyle, hx, hy);
  if (has("body")) paintProfileFace(grid, look.hairStyle, hx, hy);
  if (has("accessory")) paintProfileAccessory(grid, look, hx, hy, x0, x1, top);

  // The near arm down the side to the elbow, then forward to the controller; the far hand on its
  // far end. Over the torso, the sleeve takes the shade, so it shows against the top. A broad
  // chest's arm hangs a little inside its front, so the hands stay within the figure's bounds.
  const sleeveRows = look.top === "tee" ? 2 : 99;
  const shoulder = Math.max(x0, g.cx - 2);
  const arm: (readonly [number, number])[] = [
    [shoulder, top + 1],
    [shoulder, top + 2],
    [shoulder - 1, top + 3],
    [shoulder - 1, top + 4],
    [shoulder - 2, top + 4 - thumbs],
  ];
  arm.forEach(([x, y], i) => {
    const isHand = i === arm.length - 1;
    if (!isHand && i < sleeveRows) {
      if (has("clothes")) grid.set(x, y, x >= x0 ? F.topShade : F.top);
    } else if (has("body")) grid.set(x, y, F.skin);
  });
  if (has("clothes")) {
    grid.rect(shoulder - 4, top + 3, 2, 2, F.device);
    // A button lit as the thumbs press it.
    if (thumbs) grid.set(shoulder - 4, top + 3, F.screen);
  }
  if (has("body")) grid.set(shoulder - 5, top + 4, F.skinShade);
}

/** Hair that hangs over the ears. */
const OVER_THE_EARS: ReadonlySet<HairStyle> = new Set(["bob", "long", "curly"]);

/**
 * A head's face in profile, facing the grid's left, over the back view's hair: the hair cleared
 * from the face's three columns under the fringe (and from what hangs in front of it), an eye, the
 * nose past the head's edge, and the ear behind unless the hair covers it.
 */
function paintProfileFace(grid: PixelGrid, style: HairStyle, hx: number, hy: number): void {
  for (let y = hy + 2; y <= hy + 12; y++) {
    for (let x = hx - 1; x <= hx + 2; x++) {
      const onFace = x >= hx && y <= hy + 7 && !(x === hx && y === hy + 7);
      const cell = grid.get(x, y);
      if (onFace) grid.set(x, y, F.skin);
      else if (cell === F.hair || cell === F.hairShade) grid.set(x, y, 0);
    }
  }
  grid.set(hx + 1, hy + 4, F.eye);
  grid.set(hx - 1, hy + 5, F.skin);
  grid.set(hx, hy + 6, F.skinShade);
  if (!OVER_THE_EARS.has(style)) {
    grid.set(hx + 4, hy + 4, F.skinShade);
    grid.set(hx + 4, hy + 5, F.skinShade);
  }
}

/** What a player wears, in profile facing the grid's left (`paintPlaying`). */
function paintProfileAccessory(
  grid: PixelGrid,
  look: FigureLook,
  hx: number,
  hy: number,
  x0: number,
  x1: number,
  top: number,
): void {
  const E = F.extra;
  const L = F.extraLight;
  switch (look.accessory) {
    case "glasses":
      // The lens's front and rim round the eye, the arm back to the ear.
      grid.set(hx, hy + 4, L);
      grid.set(hx, hy + 3, E);
      grid.set(hx + 1, hy + 3, E);
      grid.row(hy + 4, hx + 2, hx + 3, E);
      break;
    case "headphones":
      grid.row(hy - 1, hx + 2, hx + 6, E);
      grid.set(hx + 1, hy, E);
      grid.set(hx + 7, hy, E);
      grid.rect(hx + 3, hy + 3, 2, 3, E);
      grid.set(hx + 3, hy + 4, L);
      break;
    case "beard":
      grid.set(hx + 3, hy + 5, E);
      grid.row(hy + 6, hx, hx + 3, E);
      grid.row(hy + 7, hx + 1, hx + 3, E);
      break;
    case "scarf":
      grid.row(top, x0, x1, E);
      grid.row(top + 1, x0, x1, E);
      grid.set(x1 - 1, top + 2, L);
      grid.set(x1 - 1, top + 3, L);
      break;
    case "none":
      break;
  }
}

/**
 * A push-up's underside off the mat at the shoulders, in pixels: frame 0 up, the arms straight
 * (with the chest's depth, a standing arm's length), frame 1 down, the chest a pixel off the mat.
 */
const PUSH_UP_LIFT = [4, 1] as const;
/** How deep a lying body is, in pixels: the chest's and the legs' side face under the back. */
const LYING_DEPTH = { torso: 2, legs: 2 } as const;
/**
 * How much narrower a lying body's back is than the standing torso, in pixels: across the floor's
 * x a width also runs down the screen, so the full width would read thicker than the head allows.
 */
const LYING_NARROWER = { torso: 2, legs: 1 } as const;
/** The head's middle past the shoulders, along the body, in pixels. */
const LYING_HEAD_AHEAD = 3;
/** The head is held up this far over the back's top. */
const LYING_HEAD_UP = 1;
/** The near arm hangs from the shoulder this far back from the body's end, in pixels along it. */
const LYING_ARM_BACK = 2;
/**
 * The anchor (the spot on the mat) is the body's middle on the floor, this much towards the head:
 * the mat's front tile holds the toes, and the back tile has the room for the head.
 */
const LYING_ANCHOR_AHEAD = 1;

/**
 * A figure lying face down along the floor's y axis, seen as everything on the floor is, from
 * above and in front: on screen the floor's y runs two pixels left for each one down, so the head
 * is up and to the right, the feet down and to the left, and the floor's x runs two pixels right
 * for each one down, so the body's near side is down and to the right of its far side. The body is
 * a slab from the toes to the shoulders: its back is the top face, as wide as the standing figure
 * (the shoulders, and the legs together), over a side face of its depth, and its ends are cut
 * along the floor's x, the toes' end the shoes' soles. The standing figure's rows (legs, torso)
 * are its length; it is held up by the near arm under the shoulder, the far arm hidden behind it.
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
  const legsLength = g.legRows;
  const length = legsLength + g.torsoBottom - g.torsoTop + 1;
  const lift = PUSH_UP_LIFT[frame % 2] ?? 0;
  const torsoWidth = 2 * g.half - LYING_NARROWER.torso;
  const legsWidth = 2 * legWidthOf(g.half) - 1 - LYING_NARROWER.legs;
  // Along the body from the toes (`u`, 0) to the shoulders (`length`), and across it from its
  // middle (`v`, negative on the far side), from the anchor on the floor.
  const middle = length / 2 + LYING_ANCHOR_AHEAD;
  const screenX = (u: number, v: number): number => Math.floor(anchorX + (u - middle) + v + 0.5);
  const floorY = (u: number, v: number): number => anchorY - (u - middle) / 2 + v / 2;
  const underside = (u: number): number => (lift * u) / length;
  const isTorso = (u: number): boolean => u >= legsLength;
  const widthAt = (u: number): number => (isTorso(u) ? torsoWidth : legsWidth);
  const depthAt = (u: number): number => (isTorso(u) ? LYING_DEPTH.torso : LYING_DEPTH.legs);
  const topAt = (u: number): number => underside(u) + depthAt(u);
  const paint = (x: number, y: number, clothes: number, body: number | null = null): void => {
    if (has("clothes")) grid.set(x, y, clothes);
    else if (body !== null && has("body")) grid.set(x, y, body);
  };

  // The near side face, from the back's edge down to the underside; then the back over it, the
  // legs' seam and the hood or the jacket's seam along the spine; then the soles at the toes.
  for (let u = 0; u <= length; u += 0.5) {
    const v = widthAt(u) / 2;
    const x = screenX(u, v);
    const floor = floorY(u, v);
    const top = Math.round(floor - topAt(u));
    const bottom = Math.round(floor - underside(u));
    for (let y = top + 1; y <= bottom; y++) {
      paint(x, y, isTorso(u) ? F.topShade : F.legsShade, F.skinShade);
    }
  }
  for (let u = 0; u <= length; u += 0.5) {
    const width = widthAt(u);
    for (let v = -width / 2; v <= width / 2; v += 0.5) {
      const x = screenX(u, v);
      const y = Math.round(floorY(u, v) - topAt(u));
      if (isTorso(u)) {
        const seam = look.top === "jacket" && Math.abs(v) < 0.5 && u < length - 1;
        const hood = look.top === "hoodie" && u >= length - 1.5 && Math.abs(v) <= 1.5;
        paint(x, y, seam || hood ? F.topShade : F.top);
      } else paint(x, y, Math.abs(v) < 0.5 ? F.legsShade : F.legs, F.skinShade);
    }
  }
  for (let v = -legsWidth / 2; v <= legsWidth / 2; v += 0.5) {
    const x = screenX(0, v);
    const floor = Math.round(floorY(0, v));
    for (let z = 0; z <= LYING_DEPTH.legs; z++) paint(x, floor - z, F.shoes);
  }

  // The near arm, under the shoulder: a tee's sleeve covers its first pixels only.
  const sleeveRows = look.top === "tee" ? 2 : 99;
  const armU = length - LYING_ARM_BACK;
  const armX = screenX(armU, torsoWidth / 2);
  const armFloor = Math.round(floorY(armU, torsoWidth / 2));
  for (const arm of lyingArm(
    frame,
    armX,
    armFloor - Math.round(topAt(armU)) + 1,
    armFloor,
    sleeveRows,
  )) {
    // The sleeve over the body, a shade darker so the arm shows against it.
    if (arm.part === "sleeve" && has("clothes")) grid.set(arm.x, arm.y, F.topShade);
    if (arm.part === "skin" && has("body")) grid.set(arm.x, arm.y, F.skin);
  }

  // The head past the shoulders, held up over the back, looking down at the mat.
  const headU = length + LYING_HEAD_AHEAD;
  const hx = screenX(headU, 0) - HEAD_HALF;
  const hy = Math.round(floorY(headU, 0) - topAt(length) - LYING_HEAD_UP) - HEAD_HALF;
  if (has("body")) paintHead(grid, hx, hy, true);
  // Face down, long hair falls no further than a bob's.
  if (has("hair")) paintHairBack(grid, look.hairStyle === "long" ? "bob" : look.hairStyle, hx, hy);
  if (has("accessory")) {
    if (look.accessory === "scarf") {
      // Round the neck: across the back's last pixel, and a little of its light side.
      for (let v = -torsoWidth / 2; v <= torsoWidth / 2; v += 0.5) {
        const y = Math.round(floorY(length, v) - topAt(length));
        grid.set(screenX(length, v), y, F.extra);
        grid.set(screenX(length - 0.5, v), y, F.extra);
      }
      grid.set(screenX(length, 0), Math.round(floorY(length, 0) - topAt(length)), F.extraLight);
    } else paintAccessory(grid, look, true, hx, hy, g);
  }
}

/**
 * A lying figure's near arm, two pixels wide, from the shoulder (`x`, `joint`) to the hand flat on
 * the floor at `floor`, its fingers towards the head: straight down in the up frame; down, bent,
 * the elbow back over the body and the forearm down from it.
 */
function lyingArm(
  frame: number,
  x: number,
  joint: number,
  floor: number,
  sleeveRows: number,
): ArmPixel[] {
  const points: [number, number][] = [];
  if (frame % 2 === 0) {
    for (let y = joint; y <= floor; y++) points.push([x, y]);
  } else {
    const elbow = x - 2;
    points.push(...line([x, joint], [elbow, joint - 2]));
    // The floor is a row lower two columns back.
    for (let y = joint - 1; y <= floor + 1; y++) points.push([elbow, y]);
  }
  const last = points.length - 1;
  const pixels = points.flatMap(([px, y], index): ArmPixel[] => {
    const part = index === last || index >= sleeveRows ? "skin" : "sleeve";
    return [
      { x: px, y, part },
      { x: px + 1, y, part },
    ];
  });
  const [handX, handY] = points[last] ?? [x, joint];
  pixels.push({ x: handX + 2, y: handY, part: "skin" });
  return pixels;
}

/**
 * A figure in a pose and frame, its head turned by `glance`, outlined, its feet's middle (a lying
 * figure's, its body's) on the anchor.
 */
export function figureShape(
  look: FigureLook,
  pose: FigurePose,
  frame: number,
  glance: HeadGlance = "ahead",
  layers: readonly FigureLayer[] = LAYERS,
): ArtShape {
  const size = figureGridOf(pose);
  const grid = new PixelGrid(size.width, size.height);
  paintFigure(grid, look, pose, frame, glance, layers);
  grid.outline(F.outline);
  return { grid, anchorX: size.anchorX, anchorY: size.anchorY };
}

const figurePalettes = new Map<string, (number | null)[]>();

/**
 * A person's figure in a pose, its head turned by `glance`, painted: shape by their Role key's
 * look, colours by it and their Avatar tint.
 */
export function paintedFigure(
  roleKey: string,
  tone: AvatarTone,
  pose: FigurePose,
  frame: number,
  glance: HeadGlance = "ahead",
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
    figureShapeKey(look, pose, frame, glance, layers),
    () => figureShape(look, pose, frame, glance, layers),
    paletteKey,
    palette,
  );
}
