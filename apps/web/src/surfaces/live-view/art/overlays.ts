import {
  type ArtShape,
  type PaintedArt,
  type Palette,
  PixelGrid,
  paintedArt,
} from "./pixel-grid.ts";

/* ---------- Signs over the floor: drawn untinted, so they read at night too ---------- */

/** The overlays' palette indexes. */
export const O = {
  outline: 1,
  white: 2,
  amber: 3,
  amberShade: 4,
  ink: 5,
  zz: 6,
  green: 7,
  gray: 8,
  accent: 9,
} as const;

export const OVERLAY_PALETTE: Palette = [
  null,
  0x2b2428,
  0xffffff,
  0xe5a00d,
  0xb57c06,
  0x2b2428,
  0x5463b8,
  0x1e9e57,
  0x8a8a84,
  0xf23d0f,
];
/** The same with a white outline, as the Z is painted. */
export const OVERLAY_PALETTE_LIGHT_OUTLINE: Palette = OVERLAY_PALETTE.map((color, i) =>
  i === O.outline ? 0xffffff : color,
);

/** 3 × 5 glyphs, a row each, "1" for a lit pixel. */
export const GLYPHS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  "+": ["000", "010", "111", "010", "000"],
  "!": ["010", "010", "010", "000", "010"],
  z: ["111", "001", "010", "100", "111"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type Glyph = keyof typeof GLYPHS;

const isGlyph = (char: string): char is Glyph => Object.hasOwn(GLYPHS, char);

/** Writes the text in glyphs, 4 pixels apart, from (x, y); a character without a glyph is left a gap. */
export function paintGlyphs(
  grid: PixelGrid,
  text: string,
  x: number,
  y: number,
  index: number,
): void {
  [...text].forEach((char, at) => {
    if (!isGlyph(char)) return;
    GLYPHS[char].forEach((row, dy) => {
      [...row].forEach((bit, dx) => {
        if (bit === "1") grid.set(x + at * 4 + dx, y + dy, index);
      });
    });
  });
}

/** An overlay painted: shape key `overlay:<key>`, palette key "overlay" or "overlay-light". */
export const paintedOverlay = (
  key: string,
  buildShape: () => ArtShape,
  lightOutline = false,
): PaintedArt =>
  paintedArt(
    `overlay:${key}`,
    buildShape,
    lightOutline ? "overlay-light" : "overlay",
    lightOutline ? OVERLAY_PALETTE_LIGHT_OUTLINE : OVERLAY_PALETTE,
  );

/** The sign above someone waiting on you. Shape key "sign". */
export function signShape(): ArtShape {
  const grid = new PixelGrid(13, 16);
  grid.rect(2, 1, 9, 10, O.amber);
  grid.set(2, 1, 0);
  grid.set(10, 1, 0);
  grid.set(2, 10, 0);
  grid.set(10, 10, 0);
  grid.row(10, 3, 9, O.amberShade);
  paintGlyphs(grid, "!", 5, 3, O.white);
  grid.rect(6, 11, 1, 3, O.amberShade);
  grid.outline(O.outline);
  return { grid, anchorX: 6, anchorY: 14 };
}

/** A speech bubble with one to three dots, its tail on the right or the left. Key `bubble:<dots>:<0|1>`. */
export function bubbleShape(dots: number, tailRight: boolean): ArtShape {
  const grid = new PixelGrid(15, 12);
  grid.rect(2, 1, 11, 7, O.white);
  grid.set(2, 1, 0);
  grid.set(12, 1, 0);
  grid.set(2, 7, 0);
  grid.set(12, 7, 0);
  const tailX = tailRight ? 10 : 4;
  grid.set(tailX, 8, O.white);
  grid.set(tailRight ? tailX + 1 : tailX - 1, 9, O.white);
  for (let dot = 0; dot < dots; dot++) grid.set(5 + dot * 2, 4, O.ink);
  grid.outline(O.outline);
  return { grid, anchorX: tailRight ? tailX + 1 : tailX - 1, anchorY: 10 };
}

/** The Z over a sleeper; painted with the light outline. Key "zz". */
export function zShape(): ArtShape {
  const grid = new PixelGrid(7, 9);
  paintGlyphs(grid, "z", 2, 2, O.zz);
  grid.outline(O.outline);
  return { grid, anchorX: 3, anchorY: 8 };
}

/** "+N" past three monitors: green while any of those sessions runs. Key `tag:<text>:<0|1>`. */
export function tagShape(text: string, lit: boolean): ArtShape {
  const width = text.length * 4 + 5;
  const grid = new PixelGrid(width + 2, 11);
  grid.rect(1, 1, width, 8, lit ? O.green : O.gray);
  grid.set(1, 1, 0);
  grid.set(width, 1, 0);
  grid.set(1, 8, 0);
  grid.set(width, 8, 0);
  paintGlyphs(grid, text, 3, 3, O.white);
  grid.outline(O.outline);
  return { grid, anchorX: Math.floor((width + 2) / 2), anchorY: 10 };
}

/** A sparkle, small on even frames and large on odd ones. Key `sparkle:<frame>`. */
export function sparkleShape(frame: number): ArtShape {
  const grid = new PixelGrid(7, 7);
  const size = frame % 2 ? 3 : 2;
  for (let i = -size; i <= size; i++) {
    grid.set(3 + i, 3, O.accent);
    grid.set(3, 3 + i, O.accent);
  }
  grid.set(3, 3, O.white);
  return { grid, anchorX: 3, anchorY: 3 };
}
