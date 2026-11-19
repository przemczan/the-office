import { describe, expect, it } from "vitest";
import { O, alarmLightShape, exclaimShape } from "./overlays.ts";

const indexesOf = (cells: Iterable<number>): Set<number> => new Set(cells);

describe("overlays", () => {
  it("draws a red exclamation mark, outlined, standing on its anchor", () => {
    const { grid, anchorX, anchorY } = exclaimShape();
    const colours = indexesOf(grid.cells);
    expect(colours.has(O.red)).toBe(true);
    expect(colours.has(O.outline)).toBe(true);
    // The dot and the bar, a gap between them.
    const column = Array.from({ length: grid.height }, (_, y) => grid.get(anchorX - 1, y));
    expect(column.join(",")).toMatch(
      new RegExp(`${O.red},${O.outline},${O.red}|${O.redShade},${O.outline},${O.red}`),
    );
    expect(anchorY).toBe(grid.height - 1);
  });

  it("lights the alarm bright red with a highlight, and leaves it dark red off", () => {
    const lit = alarmLightShape(true);
    const unlit = alarmLightShape(false);
    expect(Array.from(lit.grid.cells)).not.toEqual(Array.from(unlit.grid.cells));
    const litColours = indexesOf(lit.grid.cells);
    const unlitColours = indexesOf(unlit.grid.cells);
    expect(litColours.has(O.red)).toBe(true);
    expect(litColours.has(O.redLight)).toBe(true);
    expect(unlitColours.has(O.redDark)).toBe(true);
    expect(unlitColours.has(O.red)).toBe(false);
    expect([lit.grid.width, lit.grid.height, lit.anchorX, lit.anchorY]).toEqual([
      unlit.grid.width,
      unlit.grid.height,
      unlit.anchorX,
      unlit.anchorY,
    ]);
  });

  it("mounts the alarm light flat on the left wall: its plate skewed down to the left as the wall's face is, the dome standing out of it", () => {
    for (const lit of [true, false]) {
      const { grid, anchorX, anchorY } = alarmLightShape(lit);
      const plate: [number, number][] = [];
      const dome: [number, number][] = [];
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          const index = grid.get(x, y);
          if (index === O.gray) plate.push([x, y]);
          if (([O.red, O.redShade, O.redDark, O.redLight] as number[]).includes(index))
            dome.push([x, y]);
        }
      }
      const columns = plate.map(([x]) => x);
      const topAt = (x: number): number =>
        Math.min(...plate.filter(([px]) => px === x).map(([, y]) => y));
      const left = Math.min(...columns);
      const right = Math.max(...columns);
      // On the left wall a horizontal edge runs down to the left: a pixel for every two across.
      expect(topAt(left) - topAt(right)).toBe(Math.round((right - left) / 2));
      // The dome stands out to the right of the plate's left edge, its top over its front.
      expect(Math.min(...dome.map(([x]) => x))).toBeGreaterThan(left);
      expect(Math.max(...dome.map(([x]) => x))).toBeGreaterThanOrEqual(right);
      const domeTop = lit ? O.redLight : O.redShade;
      const front = lit ? O.red : O.redDark;
      expect(
        Math.min(...dome.filter(([x, y]) => grid.get(x, y) === domeTop).map(([, y]) => y)),
      ).toBeLessThan(
        Math.min(...dome.filter(([x, y]) => grid.get(x, y) === front).map(([, y]) => y)),
      );
      // Its origin is the plate's bottom, at its right end where it starts along the wall (the
      // dome's front covers a little of the plate there).
      expect(anchorX).toBe(right + 1);
      const bottomRight = Math.max(...plate.filter(([x]) => x === right).map(([, y]) => y));
      expect(anchorY - bottomRight).toBeGreaterThanOrEqual(1);
      expect(anchorY - bottomRight).toBeLessThanOrEqual(3);
    }
  });
});
