import type { PaletteBase } from "@the-office/ui";
import type { ReactNode } from "react";

/** The building's box, traced from the mark's 1200 × 1276 artboard with the artboard cropped off. */
const WIDTH = 798;
const HEIGHT = 874;
const WINDOW = { width: 152, height: 114, radius: 28 } as const;
const COLUMNS = [114, 323, 532] as const;
const ROWS = [114, 285, 456] as const;

/** The windows as a 3/2/1 staircase, by column and row; the ember one is the middle top. */
const WINDOWS = [
  [COLUMNS[0], ROWS[0]],
  [COLUMNS[2], ROWS[0]],
  [COLUMNS[0], ROWS[1]],
  [COLUMNS[1], ROWS[1]],
  [COLUMNS[0], ROWS[2]],
] as const;
const EMBER_WINDOW = [COLUMNS[1], ROWS[0]] as const;
const DOOR = { x: COLUMNS[1], y: 664, height: 210 } as const;

/** The body and the openings swap so the building stays visible against a dark palette. */
const INKS: Readonly<Record<PaletteBase, { readonly body: string; readonly openings: string }>> = {
  light: { body: "var(--gray-950)", openings: "var(--gray-50)" },
  dark: { body: "var(--gray-50)", openings: "var(--gray-950)" },
};
const EMBER = "var(--ember-500)";

/** The Office's own mark: a building with six windows, the middle top one lit in ember, and a door. */
export function OfficeMark({
  size,
  tone,
}: {
  /** The height in pixels; the width follows the building's proportions. */
  readonly size: number;
  readonly tone: PaletteBase;
}): ReactNode {
  const { body, openings } = INKS[tone];
  return (
    <svg
      width={(size * WIDTH) / HEIGHT}
      height={size}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      style={{ display: "block", flex: "none" }}
      aria-hidden="true"
    >
      <rect width={WIDTH} height={HEIGHT} rx={95} fill={body} />
      {WINDOWS.map(([x, y]) => (
        <Window key={`${x}-${y}`} x={x} y={y} fill={openings} />
      ))}
      <Window x={EMBER_WINDOW[0]} y={EMBER_WINDOW[1]} fill={EMBER} />
      <rect
        x={DOOR.x}
        y={DOOR.y}
        width={WINDOW.width}
        height={DOOR.height}
        rx={WINDOW.radius}
        fill={openings}
      />
    </svg>
  );
}

function Window({
  x,
  y,
  fill,
}: {
  readonly x: number;
  readonly y: number;
  readonly fill: string;
}): ReactNode {
  return (
    <rect x={x} y={y} width={WINDOW.width} height={WINDOW.height} rx={WINDOW.radius} fill={fill} />
  );
}
