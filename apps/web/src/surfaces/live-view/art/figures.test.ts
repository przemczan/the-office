import { Avatar } from "@the-office/ui";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { FigurePose } from "../live-view-types.ts";
import {
  ACCESSORIES,
  BUILDS,
  F,
  FIGURE,
  type FigureLook,
  HAIR_STYLES,
  LYING_FIGURE,
  TOPS,
  figureBoundsOf,
  figureShape,
  lookOf,
} from "./figures.ts";
import { avatarToneIndex, toneColours } from "./palettes.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POSES: readonly FigurePose[] = ["stand-front", "sit-back", "sit-back-raise", "walk-front"];

const cellsOf = (look: FigureLook, pose: FigurePose, frame: number): number[] =>
  Array.from(figureShape(look, pose, frame).grid.cells);

/** The tint an Avatar renders for a name, by its initials' colour token (`var(--blue-700)` → "blue"). */
function renderedTone(name: string): string | null {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(Avatar, { name })));
  const style = host.querySelector("span")?.getAttribute("style") ?? "";
  act(() => root.unmount());
  return /color:\s*var\(--([a-z]+)-700\)/.exec(style)?.[1] ?? null;
}

describe("figures", () => {
  it("gives a Role key the same look and the same pixels every time", () => {
    for (const roleKey of ["developer", "office-manager", "cto"]) {
      const look = lookOf(roleKey);
      // A fresh copy: the same draw from the seed, not the cached object.
      const again: FigureLook = { ...lookOf(roleKey) };
      expect(again).toEqual(look);
      for (const pose of POSES) {
        const first = figureShape(look, pose, 1).grid.cells;
        const second = figureShape(again, pose, 1).grid.cells;
        expect(Array.from(second)).toEqual(Array.from(first));
        expect(first.some((cell) => cell !== 0)).toBe(true);
      }
    }
  });

  it.each(["walk-front", "walk-back"] as const)(
    "draws %s in four frames: a step with each foot between two passing frames",
    (pose) => {
      const look = lookOf("developer");
      const cells = (frame: number): number[] =>
        Array.from(figureShape(look, pose, frame).grid.cells);
      const [passing, leftStep, passingAgain, rightStep] = [0, 1, 2, 3].map(cells);
      for (const frame of [0, 1, 2, 3]) expect(cells(frame)).toEqual(cells(frame));
      expect(passingAgain).toEqual(passing);
      expect(leftStep).not.toEqual(passing);
      expect(rightStep).not.toEqual(passing);
      expect(rightStep).not.toEqual(leftStep);
      const otherWay = pose === "walk-front" ? "walk-back" : "walk-front";
      expect(Array.from(figureShape(look, otherWay, 1).grid.cells)).not.toEqual(leftStep);
    },
  );

  describe("the pastimes' poses", () => {
    const PASTIME_POSES: readonly FigurePose[] = [
      "stand-front-cup",
      "sit-front-phone",
      "stand-front-jacks",
      "stand-front-squat",
      "lie-front-push-up",
      "stand-back-read",
      "stand-back-water",
      "sit-back-stretch",
    ];
    const ANIMATED: readonly FigurePose[] = [
      "stand-front-jacks",
      "stand-front-squat",
      "lie-front-push-up",
      "stand-back-read",
      "stand-back-water",
      "sit-back-stretch",
    ];
    const roleKeys = Array.from({ length: 40 }, (_, i) => `role-${i}`);

    it("are drawn for builds, heights, hair, tops and accessories of every kind", () => {
      const looks = roleKeys.map(lookOf);
      const covers = <T>(options: readonly T[], of: (look: FigureLook) => T): boolean =>
        options.every((option) => looks.some((look) => of(look) === option));
      expect(covers(BUILDS, (look) => look.build)).toBe(true);
      expect(covers([true, false], (look) => look.tall)).toBe(true);
      expect(covers(HAIR_STYLES, (look) => look.hairStyle)).toBe(true);
      expect(covers(TOPS, (look) => look.top)).toBe(true);
      expect(covers(ACCESSORIES, (look) => look.accessory)).toBe(true);
    });

    it.each(PASTIME_POSES)("paints %s in each frame, inside its grid, outlined", (pose) => {
      for (const roleKey of roleKeys) {
        const look = lookOf(roleKey);
        for (const frame of [0, 1]) {
          const { grid } = figureShape(look, pose, frame);
          expect(grid.cells.some((cell) => cell !== 0 && cell !== F.outline)).toBe(true);
          // Nothing but the outline touches the grid's edge: nothing was cut off.
          for (let x = 0; x < grid.width; x++) {
            for (const y of [0, grid.height - 1]) expect([0, F.outline]).toContain(grid.get(x, y));
          }
          for (let y = 0; y < grid.height; y++) {
            for (const x of [0, grid.width - 1]) expect([0, F.outline]).toContain(grid.get(x, y));
          }
        }
      }
    });

    it.each(ANIMATED)("moves %s between frame 0 and frame 1", (pose) => {
      for (const roleKey of roleKeys) {
        const look = lookOf(roleKey);
        expect(cellsOf(look, pose, 1)).not.toEqual(cellsOf(look, pose, 0));
      }
    });

    it.each(PASTIME_POSES)("gives a Role key the same pixels for %s every time", (pose) => {
      for (const roleKey of roleKeys.slice(0, 5)) {
        const again: FigureLook = { ...lookOf(roleKey) };
        for (const frame of [0, 1]) {
          expect(cellsOf(again, pose, frame)).toEqual(cellsOf(lookOf(roleKey), pose, frame));
        }
      }
    });

    it("lays a push-up along the floor's y axis: wider than high, head up and to the right", () => {
      for (const roleKey of roleKeys) {
        const { grid, anchorX, anchorY } = figureShape(lookOf(roleKey), "lie-front-push-up", 0);
        expect([grid.width, grid.height, anchorX, anchorY]).toEqual([
          LYING_FIGURE.width,
          LYING_FIGURE.height,
          LYING_FIGURE.anchorX,
          LYING_FIGURE.anchorY,
        ]);
        const painted: [number, number][] = [];
        for (let y = 0; y < grid.height; y++) {
          for (let x = 0; x < grid.width; x++) if (grid.get(x, y) > F.outline) painted.push([x, y]);
        }
        const xs = painted.map(([x]) => x);
        const ys = painted.map(([, y]) => y);
        // As wide as a standing figure's whole grid, or wider.
        expect(Math.max(...xs) - Math.min(...xs) + 1).toBeGreaterThanOrEqual(FIGURE.width);
        // The topmost pixels (hair or head) are up and to the right; the shoes down and to the left.
        const topRow = Math.min(...ys);
        expect(painted.every(([x, y]) => y !== topRow || x > anchorX)).toBe(true);
        const shoes = painted.filter(([x, y]) => grid.get(x, y) === F.shoes);
        expect(Math.max(...shoes.map(([x]) => x))).toBeLessThan(anchorX);
        expect(Math.min(...shoes.map(([, y]) => y))).toBeGreaterThan(anchorY);
        // Within its bounds, from its middle.
        const bounds = figureBoundsOf("lie-front-push-up");
        expect(Math.min(...xs) - anchorX).toBeGreaterThanOrEqual(bounds.left);
        expect(Math.max(...xs) - anchorX).toBeLessThanOrEqual(bounds.right);
        expect(Math.max(...ys) - anchorY).toBeLessThanOrEqual(bounds.bottom);
      }
    });
  });

  it("spreads Role keys over several options of each part of the look", () => {
    const looks = Array.from({ length: 40 }, (_, i) => lookOf(`role-${i}`));
    const distinct = (field: keyof FigureLook): number =>
      new Set(looks.map((look) => look[field])).size;
    expect(distinct("build")).toBeGreaterThanOrEqual(3);
    expect(distinct("tall")).toBe(2);
    expect(distinct("skin")).toBeGreaterThanOrEqual(4);
    expect(distinct("hairStyle")).toBeGreaterThanOrEqual(5);
    expect(distinct("hair")).toBeGreaterThanOrEqual(4);
    expect(distinct("top")).toBe(3);
    expect(distinct("accessory")).toBeGreaterThanOrEqual(4);
    expect(distinct("trousers")).toBeGreaterThanOrEqual(3);
    expect(distinct("shoes")).toBeGreaterThanOrEqual(3);
  });

  it("tints a person's figure with the tone their Avatar shows", () => {
    const names = [
      "Pam",
      "Jan",
      "Michael",
      "Dwight",
      "Angela",
      "Jim",
      "Stanley",
      "Phyllis",
      "Oscar",
      "Kevin",
      "Creed",
      "Meredith",
      "Ryan",
      "Kelly",
      "Toby",
      "Andy",
      "Erin",
      "Darryl",
      "Holly",
      "Gabe",
      "Ada Lovelace",
      "Zoë",
    ];
    const tones = new Set<string>();
    for (const name of names) {
      const tone = toneColours(avatarToneIndex(name)).name;
      expect({ name, tone: renderedTone(name) }).toEqual({ name, tone });
      tones.add(tone);
    }
    expect(tones.size).toBeGreaterThanOrEqual(4);
  });
});
