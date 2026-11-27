import type { DeskGroup, Sky } from "../live-view-types.ts";
import { type ArtShape, type PaintedArt, type Palette, paintedArt } from "./pixel-grid.ts";

/* ---------- The art's palette: sprite data, so numbers, not CSS tokens ---------- */
export const ART_COLORS = {
  floorA: 0xddcaa8,
  floorSeam: 0xccb48f,
  wallFace: 0xf0e9dd,
  wallSide: 0xe3dacb,
  wallTop: 0xc8bead,
  baseboard: 0xb8ac98,
  /* The slab the room stands on: its right and front sides, the light along its edge, its shadow. */
  slabSide: 0x9f8c70,
  slabFront: 0x83735c,
  slabLip: 0xe6d7be,
  slabShadow: 0x2a1f12,
  frame: 0xfbf8f2,
  sill: 0xd2c8b6,
  glass: 0xbfe2fb,
  glassHigh: 0xe2f2fe,
  glassStar: 0xe2f2fe,
  exitSign: 0x2fbf71,
  exitSignInk: 0xeafff2,
  doorFrame: 0xf7f2e9,
  doorPanel: 0xa9774d,
  doorPanelShade: 0x8c613c,
  doorHandle: 0xe5c07b,
  doorway: 0x3a3842,
  deskTop: 0xf2ede5,
  deskLeft: 0xd0c7b9,
  deskRight: 0xbeb4a5,
  deskEdge: 0xfbf9f5,
  monitorFrame: 0x2b2e35,
  monitorSide: 0x1f2127,
  screenOff: 0x3b4251,
  screenLit: 0xc4e8ff,
  codeA: 0x3b82c4,
  codeB: 0x7a5cd6,
  codeC: 0x2f9e6a,
  stand: 0x5c616b,
  chairSeat: 0x454951,
  chairSeatSide: 0x353840,
  chairBack: 0x50545d,
  chairBackSide: 0x3a3d45,
  chairBase: 0x25272c,
  lampBody: 0x3d3f45,
  lampShade: 0xe9c46a,
  lampShadeSide: 0xc9a24a,
  bulb: 0xfff4c2,
  pizzaTop: 0xd9b17b,
  pizzaSide: 0xb98d55,
  pizzaLogo: 0xc8102e,
  noteTop: 0xffe08a,
  noteSide: 0xd9b44a,
  noteInk: 0xb08a2e,
  mug: 0xf7f7f5,
  carpetFront: 0xecd6bf,
  carpetFrontEdge: 0xddc1a3,
  carpetConsultants: 0xcde0cf,
  carpetConsultantsEdge: 0xb5ccb8,
  carpetTeam: 0xcfd8e8,
  carpetTeamEdge: 0xb8c5dc,
  dividerFront: 0xd99a7a,
  dividerFrontSide: 0xc3825f,
  dividerConsultants: 0x82b08d,
  dividerConsultantsSide: 0x6a9977,
  dividerTeam: 0x8299c3,
  dividerTeamSide: 0x6a82ad,
  sofaTop: 0xc4705a,
  sofaLeft: 0xa85b45,
  sofaRight: 0x964f3b,
  cushion: 0xd7846c,
  beanA: 0xe0a93b,
  beanAShade: 0xc18e27,
  beanB: 0x5f8fd0,
  beanBShade: 0x4a76b4,
  beanC: 0x8f74c6,
  beanCShade: 0x755aad,
  rug: 0xe6cfac,
  rugEdge: 0xc99f6c,
  rugInner: 0xd9bb90,
  gamesRug: 0xd5dfcf,
  gamesRugEdge: 0xaebfa6,
  tableTop: 0xece2d3,
  tableSide: 0xcdbda4,
  machine: 0x3b3e45,
  machineSide: 0x2c2e34,
  machineTop: 0x585c63,
  machineLed: 0xff5a3c,
  cabinet: 0xc99e74,
  cabinetSide: 0xab835b,
  cabinetRight: 0x966f4a,
  cooler: 0xe0e8f0,
  coolerSide: 0xc5d1dc,
  water: 0x8fc9f2,
  waterSide: 0x6db0e2,
  potTop: 0xc97b54,
  potSide: 0xb06644,
  potRight: 0x9a5739,
  leaf: 0x4f9b59,
  leafDark: 0x3a7a45,
  leafLight: 0x7cc176,
  bookA: 0xc8102e,
  bookB: 0x2f6bdb,
  bookC: 0xe5a00d,
  bookD: 0x1e9e57,
  bookE: 0xf4f4f2,
  tvStand: 0x6b5a4a,
  tvStandSide: 0x564738,
  tvStandRight: 0x47392c,
  consoleBody: 0x2a2c33,
  consoleTop: 0x3c3f48,
  consoleLight: 0x4fd1ff,
  pillowA: 0xd9706a,
  pillowAShade: 0xb8554f,
  pillowB: 0x6aa8a0,
  pillowBShade: 0x4f8b83,
  pillowC: 0xe3b65a,
  pillowCShade: 0xc39a3f,
  gameSky: 0x6fc3ff,
  gameCloud: 0xf2fbff,
  gameGround: 0x4caf50,
  gameDirt: 0x9a6a3c,
  gameHeroA: 0xe53935,
  gameHeroB: 0x3f51b5,
  gameCoin: 0xffd54f,
  printer: 0xe8e8e4,
  printerSide: 0xcacac5,
  printerTop: 0xd6d6d1,
  paper: 0xffffff,
  nextDesk: 0xf23d0f,
  mat: 0x5aa39b,
  matSide: 0x43867f,
  matStripe: 0x8fd3c9,
} as const;

export type ArtColorName = keyof typeof ART_COLORS;

const ART_NAMES = Object.keys(ART_COLORS) as ArtColorName[];

/** Each art colour's palette index, from 1 (0 is transparent). */
export const ART = Object.fromEntries(ART_NAMES.map((name, i) => [name, i + 1])) as Readonly<
  Record<ArtColorName, number>
>;

export const ART_PALETTE: Palette = [null, ...ART_NAMES.map((name) => ART_COLORS[name])];

/** The art's palette with some indexes swapped, the rest left out (transparent) when `only`. */
export function artPalette(
  overrides: Partial<Readonly<Record<ArtColorName, number | null>>>,
  only = false,
): (number | null)[] {
  const palette = only ? ART_PALETTE.map(() => null) : ART_PALETTE.slice();
  for (const name of Object.keys(overrides) as ArtColorName[]) {
    palette[ART[name]] = overrides[name] ?? null;
  }
  return palette;
}

/** The windows' glass for each sky; night's stars are `glassStar`, the other skies hide them. */
export const SKY_PALETTES: Readonly<
  Record<Sky, Readonly<Record<"glass" | "glassHigh" | "glassStar", number>>>
> = {
  day: { glass: 0xbfe2fb, glassHigh: 0xe2f2fe, glassStar: 0xe2f2fe },
  golden: { glass: 0xffd8a8, glassHigh: 0xffeccf, glassStar: 0xffeccf },
  dusk: { glass: 0xf08f6c, glassHigh: 0x8c74b8, glassStar: 0x8c74b8 },
  dawn: { glass: 0xf4b2b8, glassHigh: 0x9aa3d6, glassStar: 0x9aa3d6 },
  night: { glass: 0x1d2748, glassHigh: 0x141c36, glassStar: 0xe9edff },
};

/** A shape painted with the art's own palette (palette key "art"). */
export const paintedOfficeArt = (shapeKey: string, buildShape: () => ArtShape): PaintedArt =>
  paintedArt(shapeKey, buildShape, "art", ART_PALETTE);

/** A desk group's divider and carpet, as art palette indexes. */
export interface GroupArt {
  readonly divider: number;
  readonly dividerSide: number;
  readonly carpet: number;
  readonly carpetEdge: number;
}

export const GROUP_ART: Readonly<Record<DeskGroup, GroupArt>> = {
  "front-desk": {
    divider: ART.dividerFront,
    dividerSide: ART.dividerFrontSide,
    carpet: ART.carpetFront,
    carpetEdge: ART.carpetFrontEdge,
  },
  consultants: {
    divider: ART.dividerConsultants,
    dividerSide: ART.dividerConsultantsSide,
    carpet: ART.carpetConsultants,
    carpetEdge: ART.carpetConsultantsEdge,
  },
  team: {
    divider: ART.dividerTeam,
    dividerSide: ART.dividerTeamSide,
    carpet: ART.carpetTeam,
    carpetEdge: ART.carpetTeamEdge,
  },
};

/* ---------- The Avatar's tint, as design-system/components/core/Avatar.jsx picks it ---------- */

/** One of the Avatar's tints: its background (`light`) and initials (`strong`), as `0xRRGGBB`. */
export interface AvatarTone {
  readonly name: string;
  readonly light: number;
  readonly strong: number;
}

/** In Avatar.jsx's order; the colours are the light theme's ramp, used when a token can't be read. */
const AVATAR_TONES: readonly AvatarTone[] = [
  { name: "blue", light: 0xdae5fa, strong: 0x1d4699 },
  { name: "green", light: 0xd5f0df, strong: 0x106a3b },
  { name: "amber", light: 0xffedc2, strong: 0x865b05 },
  { name: "ember", light: 0xffe0d4, strong: 0x9e2406 },
  { name: "gray", light: 0xe9e9e6, strong: 0x3a3a37 },
  { name: "red", light: 0xfad9dd, strong: 0x8e0b20 },
];

/** How many tints the Avatar picks from. */
export const AVATAR_TONE_COUNT = AVATAR_TONES.length;

/** The tint Avatar.jsx gives a name, by its index in the Avatar's order. */
export function avatarToneIndex(name: string): number {
  let hash = 0;
  // As Avatar.jsx: by code point, each one's first UTF-16 unit.
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash % AVATAR_TONES.length;
}

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` as `0xRRGGBB`, or null when it is none of those. */
function parseCssColour(text: string): number | null {
  const value = text.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  if (short)
    return parseInt(`${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`, 16);
  if (/^#[0-9a-f]{6}$/.test(value)) return parseInt(value.slice(1), 16);
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value);
  if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
  return null;
}

/** A tint's colours as the page's ramp tokens give them now (`--blue-100`, `--blue-700`, …). */
export function toneColours(index: number): AvatarTone {
  const fallback = AVATAR_TONES[index % AVATAR_TONES.length] ?? AVATAR_TONES[0];
  if (!fallback) throw new Error("No Avatar tones");
  const style = getComputedStyle(document.documentElement);
  const token = (step: number): number | null =>
    parseCssColour(style.getPropertyValue(`--${fallback.name}-${step}`));
  return {
    name: fallback.name,
    light: token(100) ?? fallback.light,
    strong: token(700) ?? fallback.strong,
  };
}

/** The tint the Avatar gives a name, in the page's colours. */
export const avatarTone = (name: string): AvatarTone => toneColours(avatarToneIndex(name));
