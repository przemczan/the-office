import { isoX, isoY } from "./iso.ts";

/** A palette: a grid's index → `0xRRGGBB`; index 0, and any missing colour, is transparent. */
export type Palette = readonly (number | null)[];

/** A pixel in a grid, `[x, y]`. */
export type GridPoint = readonly [number, number];

/** Every sprite is a grid of palette indexes, painted once per palette. */
export class PixelGrid {
  readonly cells: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cells = new Uint8Array(width * height);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.cells[y * this.width + x] ?? 0;
  }

  set(x: number, y: number, index: number): void {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height)
      this.cells[y * this.width + x] = index;
  }

  rect(x: number, y: number, width: number, height: number, index: number): void {
    for (let row = y; row < y + height; row++) {
      for (let column = x; column < x + width; column++) this.set(column, row, index);
    }
  }

  row(y: number, from: number, to: number, index: number): void {
    for (let x = from; x <= to; x++) this.set(x, y, index);
  }

  line(x0: number, y0: number, x1: number, y1: number, index: number): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xEnd = Math.round(x1);
    const yEnd = Math.round(y1);
    const dx = Math.abs(xEnd - x);
    const dy = -Math.abs(yEnd - y);
    const stepX = x < xEnd ? 1 : -1;
    const stepY = y < yEnd ? 1 : -1;
    let error = dx + dy;
    for (;;) {
      this.set(x, y, index);
      if (x === xEnd && y === yEnd) break;
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        x += stepX;
      }
      if (doubled <= dx) {
        error += dx;
        y += stepY;
      }
    }
  }

  /** Fills the pixels whose centres fall inside the polygon. */
  polygon(points: readonly GridPoint[], index: number): void {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const right = Math.min(this.width - 1, Math.ceil(Math.max(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const bottom = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        if (insidePolygon(points, x + 0.5, y + 0.5)) this.cells[y * this.width + x] = index;
      }
    }
  }

  ellipse(centreX: number, centreY: number, radiusX: number, radiusY: number, index: number): void {
    for (let y = Math.floor(centreY - radiusY); y <= Math.ceil(centreY + radiusY); y++) {
      for (let x = Math.floor(centreX - radiusX); x <= Math.ceil(centreX + radiusX); x++) {
        const dx = (x + 0.5 - centreX) / radiusX;
        const dy = (y + 0.5 - centreY) / radiusY;
        if (dx * dx + dy * dy <= 1) this.set(x, y, index);
      }
    }
  }

  /** Rings every opaque shape with the outline index, outside its own pixels. */
  outline(index: number): void {
    const before = this.cells.slice();
    const opaque = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < this.width && y < this.height && before[y * this.width + x] !== 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (before[y * this.width + x] !== 0) continue;
        if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) {
          this.cells[y * this.width + x] = index;
        }
      }
    }
  }
}

function insidePolygon(points: readonly GridPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] ?? [0, 0];
    const [xj, yj] = points[j] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A grid with the pixel its origin lands on. */
export interface ArtShape {
  readonly grid: PixelGrid;
  readonly anchorX: number;
  readonly anchorY: number;
}

/** A point on the floor, in tiles, and a height in pixels. */
export type TilePoint = readonly [x: number, y: number, z?: number];

/** Draws on a grid in floor tiles and heights in pixels, from the anchor the floor's origin lands on. */
export interface IsoPen {
  readonly grid: PixelGrid;
  /** A floor point as a whole pixel of the grid. */
  point(x: number, y: number, z?: number): GridPoint;
  /**
   * A box from (x, y, z), w × d tiles and h pixels high: its top and the two faces we see. An index
   * of 0 leaves that face out.
   */
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    top: number,
    left: number,
    right: number,
    edge?: number,
  ): void;
  /** A rectangle on a plane of constant x, facing +x (down and to the right). */
  faceX(x: number, y0: number, y1: number, z0: number, z1: number, index: number): void;
  /** A rectangle on a plane of constant y, facing +y (down and to the left). */
  faceY(y: number, x0: number, x1: number, z0: number, z1: number, index: number): void;
  floor(x0: number, y0: number, x1: number, y1: number, index: number, z?: number): void;
  line(from: TilePoint, to: TilePoint, index: number): void;
  ellipse(x: number, y: number, z: number, radiusX: number, radiusY: number, index: number): void;
}

export function isoPen(grid: PixelGrid, anchorX: number, anchorY: number): IsoPen {
  const point = (x: number, y: number, z = 0): GridPoint => [
    anchorX + Math.round(isoX(x, y)),
    anchorY + Math.round(isoY(x, y, z)),
  ];
  const line = (from: TilePoint, to: TilePoint, index: number): void => {
    const [x0, y0] = point(from[0], from[1], from[2]);
    const [x1, y1] = point(to[0], to[1], to[2]);
    grid.line(x0, y0, x1, y1, index);
  };
  return {
    grid,
    point,
    box(x, y, z, w, d, h, top, left, right, edge) {
      if (left) {
        grid.polygon(
          [
            point(x, y + d, z + h),
            point(x + w, y + d, z + h),
            point(x + w, y + d, z),
            point(x, y + d, z),
          ],
          left,
        );
      }
      if (right) {
        grid.polygon(
          [
            point(x + w, y, z + h),
            point(x + w, y + d, z + h),
            point(x + w, y + d, z),
            point(x + w, y, z),
          ],
          right,
        );
      }
      if (top) {
        grid.polygon(
          [
            point(x, y, z + h),
            point(x + w, y, z + h),
            point(x + w, y + d, z + h),
            point(x, y + d, z + h),
          ],
          top,
        );
      }
      if (edge) {
        line([x, y + d, z + h], [x + w, y + d, z + h], edge);
        line([x + w, y, z + h], [x + w, y + d, z + h], edge);
      }
    },
    faceX(x, y0, y1, z0, z1, index) {
      grid.polygon([point(x, y0, z1), point(x, y1, z1), point(x, y1, z0), point(x, y0, z0)], index);
    },
    faceY(y, x0, x1, z0, z1, index) {
      grid.polygon([point(x0, y, z1), point(x1, y, z1), point(x1, y, z0), point(x0, y, z0)], index);
    },
    floor(x0, y0, x1, y1, index, z = 0) {
      grid.polygon([point(x0, y0, z), point(x1, y0, z), point(x1, y1, z), point(x0, y1, z)], index);
    },
    line,
    ellipse(x, y, z, radiusX, radiusY, index) {
      const [centreX, centreY] = point(x, y, z);
      grid.ellipse(centreX, centreY, radiusX, radiusY, index);
    },
  };
}

/** A shape's extent: x and y in tiles, the height in pixels. */
export interface IsoBounds {
  readonly minX?: number;
  readonly maxX: number;
  readonly minY?: number;
  readonly maxY: number;
  readonly maxZ: number;
}

/** A shape whose origin, (0, 0, 0) in tiles, lands on its anchor; bounds in tiles, height in pixels. */
export function isoShape(bounds: IsoBounds, paint: (pen: IsoPen) => void): ArtShape {
  const { minX = 0, maxX, minY = 0, maxY, maxZ } = bounds;
  const left = Math.floor(isoX(minX, maxY)) - 2;
  const right = Math.ceil(isoX(maxX, minY)) + 2;
  const top = Math.floor(isoY(minX, minY, maxZ)) - 2;
  const bottom = Math.ceil(isoY(maxX, maxY)) + 2;
  const grid = new PixelGrid(right - left, bottom - top);
  paint(isoPen(grid, -left, -top));
  return { grid, anchorX: -left, anchorY: -top };
}

/* ---------- Colours, as `0xRRGGBB` ---------- */

const channelsOf = (color: number): readonly [number, number, number] => [
  (color >> 16) & 0xff,
  (color >> 8) & 0xff,
  color & 0xff,
];
const clampChannel = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

export function mix(from: number, to: number, amount: number): number {
  const a = channelsOf(from);
  const b = channelsOf(to);
  const [red, green, blue] = a.map((value, i) =>
    clampChannel(value + ((b[i] ?? 0) - value) * amount),
  );
  return ((red ?? 0) << 16) | ((green ?? 0) << 8) | (blue ?? 0);
}
export const darker = (color: number, amount: number): number => mix(color, 0x000000, amount);
export const lighter = (color: number, amount: number): number => mix(color, 0xffffff, amount);

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

/** A grid painted with a palette: index → colour, a missing colour left transparent. */
export function paintGrid(grid: PixelGrid, palette: Palette): HTMLCanvasElement {
  const canvas = canvasOf(grid.width, grid.height);
  const context = canvas.getContext("2d");
  // No 2D context (jsdom without the canvas package): the canvas stays blank.
  if (!context) return canvas;
  const image = context.createImageData(grid.width, grid.height);
  for (let i = 0; i < grid.cells.length; i++) {
    const color = palette[grid.cells[i] ?? 0];
    // Black, 0x000000, is a colour: only null and undefined are transparent.
    if (color === null || color === undefined) continue;
    const [red, green, blue] = channelsOf(color);
    image.data[i * 4] = red;
    image.data[i * 4 + 1] = green;
    image.data[i * 4 + 2] = blue;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** A shape painted with one palette, with the pixel its origin lands on. */
export interface PaintedArt {
  readonly canvas: HTMLCanvasElement;
  readonly anchorX: number;
  readonly anchorY: number;
}

/* A shape is built once, then painted once per palette (the stage: one Texture each). */
const shapes = new Map<string, ArtShape>();
const painted = new Map<string, PaintedArt>();

/** A shape painted with a palette: shapes cached by `shapeKey`, canvases by `shapeKey|paletteKey`. */
export function paintedArt(
  shapeKey: string,
  buildShape: () => ArtShape,
  paletteKey: string,
  palette: Palette,
): PaintedArt {
  const key = `${shapeKey}|${paletteKey}`;
  let made = painted.get(key);
  if (!made) {
    let shape = shapes.get(shapeKey);
    if (!shape) {
      shape = buildShape();
      shapes.set(shapeKey, shape);
    }
    made = {
      canvas: paintGrid(shape.grid, palette),
      anchorX: shape.anchorX,
      anchorY: shape.anchorY,
    };
    painted.set(key, made);
  }
  return made;
}

/** Drops every cached shape and canvas, as when the stage is destroyed. */
export function forgetPaintedArt(): void {
  shapes.clear();
  painted.clear();
}
