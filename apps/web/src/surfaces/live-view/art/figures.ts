import type { FigurePose } from "../live-view-types.ts";
import { type AvatarTone } from "./palettes.ts";
import {
  type ArtShape,
  type PaintedArt,
  PixelGrid,
  darker,
  lighter,
  paintedArt,
} from "./pixel-grid.ts";

/* ---------- A seeded random: the same Role key always gives the same figure ---------- */

/** FNV-1a over the text's code points (each one's first UTF-16 unit). */
export function seedOf(text: string): number {
  let hash = 2166136261;
  for (const c of text) {
    hash ^= c.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: numbers in [0, 1), the same ones for the same seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickFrom<T>(random: () => number, list: readonly [T, ...T[]]): T {
  return list[Math.floor(random() * list.length)] ?? list[0];
}

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
} as const;

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
  const colors: (number | null)[] = Array.from({ length: F.mug + 1 }, () => null);
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

/** A figure's rows in a pose: where its feet, torso and head go. */
export interface FigureFrame {
  readonly seated: boolean;
  readonly stride: boolean;
  /** Half the torso's width. */
  readonly half: number;
  readonly legRows: number;
  readonly torsoTop: number;
  readonly torsoBottom: number;
  readonly headTop: number;
  readonly cx: number;
}

const HALF_BY_BUILD: Readonly<Record<Build, number>> = { slim: 3, regular: 4, broad: 5 };

export function figureFrame(look: FigureLook, pose: FigurePose, frame: number): FigureFrame {
  const seated = pose.startsWith("sit");
  const stride = pose.startsWith("walk") && frame % 2 === 1;
  const half = HALF_BY_BUILD[look.build];
  const legRows = look.tall ? 6 : 5;
  const torsoRows = look.tall ? 8 : 7;
  const torsoBottom = seated ? FIGURE.ground - 4 : FIGURE.ground - legRows - 1 + (stride ? 1 : 0);
  const torsoTop = torsoBottom - torsoRows + 1;
  const headTop = torsoTop - 8;
  return { seated, stride, half, legRows, torsoTop, torsoBottom, headTop, cx: FIGURE.centre };
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
  const back = pose.includes("back");
  const sleep = pose === "sit-back-sleep";
  const breathe = sleep ? frame % 2 : 0;
  const hx = g.cx - 4 + (sleep ? -3 : 0);
  const hy = g.headTop + (sleep ? 3 + breathe : 0);
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
  if (pose === "stand-front-mug" && has("clothes")) {
    const x = g.cx + g.half + 1;
    grid.rect(x, g.torsoTop + 3, 2, 2, F.mug);
    grid.set(x + 2, g.torsoTop + 3, F.mug);
  }
}

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
  const hangTo = g.torsoBottom - 1;
  switch (pose) {
    case "sit-back":
      column(leftX, shoulder, shoulder + 2, leftX - (frame % 2));
      column(rightX, shoulder, shoulder + 2, rightX - 1 + (frame % 2));
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
  if (g.seated) {
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
  for (let y = g.torsoBottom + 1; y < FIGURE.ground; y++) {
    const low = y >= FIGURE.ground - 2;
    for (let x = left0; x < g.cx; x++) trousers.push([x - (low ? step : 0), y, false]);
    for (let x = g.cx; x <= right1; x++) trousers.push([x + (low ? step : 0), y, true]);
  }
  const toe = back ? 0 : 1;
  for (let x = left0; x < g.cx + toe; x++) shoes.push([x - step, FIGURE.ground]);
  for (let x = g.cx; x <= right1 + toe; x++) shoes.push([x + step, FIGURE.ground]);
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

/** A figure in a pose and frame, outlined, its feet's middle on the anchor. */
export function figureShape(
  look: FigureLook,
  pose: FigurePose,
  frame: number,
  layers: readonly FigureLayer[] = LAYERS,
): ArtShape {
  const grid = new PixelGrid(FIGURE.width, FIGURE.height);
  paintFigure(grid, look, pose, frame, layers);
  grid.outline(F.outline);
  return { grid, anchorX: FIGURE.anchorX, anchorY: FIGURE.anchorY };
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
