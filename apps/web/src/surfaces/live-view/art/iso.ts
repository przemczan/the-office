/** Isometric projection: 2:1 tiles of 32 × 16 art pixels (design decision 2). */
export const HALF_W = 16;
export const HALF_H = 8;
/** The back and left walls' height, in art pixels. */
export const WALL_H = 44;
/** A desk top's height, in art pixels. */
export const DESK_H = 8;

/** A floor point's x in art pixels, from tiles. */
export const isoX = (x: number, y: number): number => (x - y) * HALF_W;
/** A floor point's y in art pixels, from tiles and a height in pixels. */
export const isoY = (x: number, y: number, z = 0): number => (x + y) * HALF_H - z;
