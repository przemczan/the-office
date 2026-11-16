import { Avatar } from "@the-office/ui";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { FigurePose, HeadGlance } from "../live-view-types.ts";
import {
  ACCESSORIES,
  BUILDS,
  F,
  FIGURE,
  type FigureLook,
  HAIR_STYLES,
  LYING_FIGURE,
  TOPS,
  armPixels,
  figureBoundsOf,
  figureFrame,
  figureShape,
  figureShapeKey,
  legPixels,
  lookOf,
} from "./figures.ts";
import { plantShape } from "./furniture.ts";
import { isoX, isoY } from "./iso.ts";
import { ART, avatarToneIndex, toneColours } from "./palettes.ts";
import type { PixelGrid } from "./pixel-grid.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POSES: readonly FigurePose[] = ["stand-front", "sit-back", "sit-back-raise", "walk-front"];

const cellsOf = (
  look: FigureLook,
  pose: FigurePose,
  frame: number,
  glance: HeadGlance = "ahead",
): number[] => Array.from(figureShape(look, pose, frame, glance).grid.cells);

/** Every pixel of a grid painted `index`, as "x,y". */
const pixelsOf = (grid: PixelGrid, ...indexes: number[]): Set<string> => {
  const pixels = new Set<string>();
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++)
      if (indexes.includes(grid.get(x, y))) pixels.add(`${x},${y}`);
  }
  return pixels;
};
const xsOf = (pixels: Set<string>): number[] =>
  [...pixels].map((pixel) => Number(pixel.split(",")[0]));
/** The rows of `indexes` in column `x`. */
const rowsOf = (grid: PixelGrid, x: number, ...indexes: number[]): number[] => {
  const rows: number[] = [];
  for (let y = 0; y < grid.height; y++) if (indexes.includes(grid.get(x, y))) rows.push(y);
  return rows;
};
const span = (xs: number[]): number => Math.max(...xs) - Math.min(...xs) + 1;

const TOP_COLOURS = [F.top, F.topShade, F.trim] as const;

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
      "stand-front-mug",
      "stand-front-cup",
      "stand-front-mug-sip",
      "stand-front-cup-sip",
      "stand-front-panic",
      "sit-back-play",
      "sit-front-phone",
      "stand-front-jacks",
      "stand-front-squat",
      "lie-front-push-up",
      "stand-back-read",
      "stand-back-water",
      "sit-back-stretch",
    ];
    const ANIMATED: readonly FigurePose[] = [
      "stand-front-panic",
      "sit-back-play",
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
        const shoeRows = shoes.map(([, y]) => y);
        expect(shoeRows.reduce((sum, y) => sum + y, 0) / shoeRows.length).toBeGreaterThan(anchorY);
        // Within its bounds, from its middle.
        const bounds = figureBoundsOf("lie-front-push-up");
        expect(Math.min(...xs) - anchorX).toBeGreaterThanOrEqual(bounds.left);
        expect(Math.max(...xs) - anchorX).toBeLessThanOrEqual(bounds.right);
        expect(Math.max(...ys) - anchorY).toBeLessThanOrEqual(bounds.bottom);
      }
    });

    it("lays the push-up as a slab seen from above, in proportion to the head: the back over its side, the legs shorter than the torso, the head past the shoulders", () => {
      for (const roleKey of roleKeys) {
        const look = lookOf(roleKey);
        const topRowOf = (frame: number): number =>
          Math.min(
            ...[
              ...pixelsOf(figureShape(look, "lie-front-push-up", frame).grid, ...TOP_COLOURS),
            ].map((pixel) => Number(pixel.split(",")[1])),
          );
        for (const frame of [0, 1]) {
          const { grid } = figureShape(look, "lie-front-push-up", frame);
          // The back, in the top's colour (a jacket's seam takes a row of it), with the side in
          // its shade right under it: a solid block.
          let thickest = 0;
          let sideUnderBack = false;
          for (let x = 0; x < grid.width; x++) {
            thickest = Math.max(thickest, rowsOf(grid, x, F.top).length);
            for (let y = 1; y < grid.height - 2; y++) {
              if (
                grid.get(x, y - 1) === F.top &&
                grid.get(x, y) === F.top &&
                grid.get(x, y + 1) === F.topShade &&
                grid.get(x, y + 2) === F.topShade
              )
                sideUnderBack = true;
            }
          }
          expect({ roleKey, frame, thickest, sideUnderBack }).toEqual({
            roleKey,
            frame,
            thickest: expect.any(Number),
            sideUnderBack: true,
          });
          expect(thickest).toBeGreaterThanOrEqual(3);
          // In proportion to the head: seen as back and side, the torso is less than twice what a
          // standing figure's front shows.
          expect(pixelsOf(grid, ...TOP_COLOURS).size).toBeLessThan(
            2 * pixelsOf(figureShape(look, "stand-front", 0).grid, ...TOP_COLOURS).size,
          );
          // The legs are a block too, and lie shorter than the torso.
          let legsThickest = 0;
          for (let x = 0; x < grid.width; x++)
            legsThickest = Math.max(legsThickest, rowsOf(grid, x, F.legs, F.legsShade).length);
          expect(legsThickest).toBeGreaterThanOrEqual(4);
          const legsXs = xsOf(pixelsOf(grid, F.legs, F.legsShade, F.shoes));
          const torsoXs = xsOf(pixelsOf(grid, ...TOP_COLOURS));
          expect(span(legsXs)).toBeLessThan(span(torsoXs));
          // The head is past the shoulders, up and to the right.
          expect(Math.max(...xsOf(pixelsOf(grid, F.skin, F.hair)))).toBeGreaterThan(
            Math.max(...torsoXs),
          );
        }
        // Up on straight arms the shoulders are higher than down with the chest at the mat.
        expect(topRowOf(0)).toBeLessThan(topRowOf(1));
      }
    });

    it("waves a panicking figure's hands beside its head, on arms about a hanging arm's length", () => {
      for (const roleKey of roleKeys) {
        const look = lookOf(roleKey);
        const g = figureFrame(look, "stand-front", 0);
        const hanging = armPixels("stand-front", 0, g, 2).filter(({ x }) => x < g.cx).length;
        const tops: number[] = [];
        for (const frame of [0, 1]) {
          const arms = armPixels("stand-front-panic", frame, g, 2);
          const left = arms.filter(({ x }) => x < g.cx);
          const right = arms.filter(({ x }) => x > g.cx);
          for (const arm of [left, right]) {
            expect(arm.length).toBeLessThanOrEqual(hanging + 2);
            const top = Math.min(...arm.map(({ y }) => y));
            // Under the head's top, over its chin.
            expect(top).toBeGreaterThan(g.headTop);
            expect(top).toBeLessThan(g.torsoTop - 2);
          }
          tops.push(Math.min(...left.map(({ y }) => y)));
        }
        // The hands swap heights from frame to frame.
        expect(tops[0]).not.toBe(tops[1]);
      }
    });

    it("draws a player in profile facing the grid's left (the TV, once the seat mirrors it), whatever the glance", () => {
      for (const roleKey of roleKeys) {
        const look = lookOf(roleKey);
        const { cx } = figureFrame(look, "sit-back-play", 0);
        for (const frame of [0, 1]) {
          const { grid } = figureShape(look, "sit-back-play", frame);
          for (const glance of ["left", "right"] as const) {
            expect(cellsOf(look, "sit-back-play", frame, glance)).toEqual(
              cellsOf(look, "sit-back-play", frame),
            );
          }
          // One eye, on the leading side.
          const eyes = xsOf(pixelsOf(grid, F.eye));
          expect(eyes).toHaveLength(1);
          expect(eyes[0]).toBeLessThan(cx);
          // The legs out in front: a knee and a shoe well left of the body's middle, the shoe
          // on the ground; the controller in front of the body too.
          const legs = xsOf(pixelsOf(grid, F.legs, F.legsShade));
          expect(Math.min(...legs)).toBeLessThanOrEqual(cx - 6);
          const shoes = pixelsOf(grid, F.shoes);
          expect(Math.min(...xsOf(shoes))).toBeLessThanOrEqual(cx - 7);
          for (const shoe of shoes) expect(shoe.endsWith(`,${FIGURE.ground}`)).toBe(true);
          expect(Math.max(...xsOf(pixelsOf(grid, F.device, F.screen)))).toBeLessThan(cx - 3);
          // Within the seated bounds, from the anchor.
          const bounds = figureBoundsOf("sit-back-play");
          const xs = xsOf(pixelsOf(grid, ...Object.values(F)));
          expect(Math.min(...xs) - FIGURE.anchorX).toBeGreaterThanOrEqual(bounds.left);
          expect(Math.max(...xs) - FIGURE.anchorX).toBeLessThanOrEqual(bounds.right);
        }
        // The thumbs work: the two frames differ.
        expect(cellsOf(look, "sit-back-play", 1)).not.toEqual(cellsOf(look, "sit-back-play", 0));
      }
    });

    it("bends a squat's knees out over feet that stay where a standing figure's are", () => {
      for (const roleKey of roleKeys) {
        const look = lookOf(roleKey);
        const standing = figureShape(look, "stand-front", 0).grid;
        const squat = figureShape(look, "stand-front-squat", 0).grid;
        const shoes = pixelsOf(squat, F.shoes);
        expect(shoes).toEqual(pixelsOf(standing, F.shoes));
        const legs = xsOf(pixelsOf(squat, F.legs, F.legsShade));
        expect(Math.min(...legs)).toBeLessThan(Math.min(...xsOf(shoes)));
        expect(Math.max(...legs)).toBeGreaterThan(Math.max(...xsOf(shoes)));
        // Lower than standing, higher than sitting.
        const torso = figureFrame(look, "stand-front-squat", 0).torsoBottom;
        expect(torso).toBeGreaterThan(figureFrame(look, "stand-front", 0).torsoBottom);
        expect(torso).toBeLessThan(figureFrame(look, "sit-front", 0).torsoBottom);
        // The up frame stands.
        expect(cellsOf(look, "stand-front-squat", 1)).toEqual(cellsOf(look, "stand-front", 0));
      }
    });

    it.each(["sit-front", "sit-front-phone", "sit-back"] as const)(
      "sits %s with the legs side by side, a column apart, never crossed",
      (pose) => {
        for (const roleKey of roleKeys) {
          const look = lookOf(roleKey);
          const g = figureFrame(look, pose, 0);
          const [left, right] = legPixels(0, g, pose.includes("back"));
          const of = (leg: typeof left): (readonly [number, number])[] => [
            ...leg.trousers.map(([x, y]): [number, number] => [x, y]),
            ...leg.shoes,
          ];
          const leftXs = of(left).map(([x]) => x);
          const rightXs = of(right).map(([x]) => x);
          expect(leftXs.length).toBeGreaterThan(0);
          expect(Math.max(...leftXs) + 1).toBeLessThan(Math.min(...rightXs));
        }
      },
    );

    it.each(["sit-front", "sit-front-phone"] as const)(
      "brings both of %s's shins down to a shoe each",
      (pose) => {
        for (const roleKey of roleKeys) {
          const look = lookOf(roleKey);
          const [left, right] = legPixels(0, figureFrame(look, pose, 0), false);
          expect([left.shoes.length > 0, right.shoes.length > 0]).toEqual([true, true]);
        }
      },
    );

    // floor-plan.ts: a plant on the back wall at (x + 0.4, 0.45) with its spot at (x + 0.45, 1.25),
    // the chill area's at (x + 0.5, 0.45) with its spot at (x + 0.5, 1.25); the figure there faces
    // the wall, mirrored.
    const PLANT_SPOTS = [
      { plant: [0.4, 0.45], spot: [0.45, 1.25] },
      { plant: [0.5, 0.45], spot: [0.5, 1.25] },
    ] as const;

    /** Where each drop of water falls on a plant's grid, from each of the spots, as `[x, y]`. */
    function dropsOnPlant(plant: ReturnType<typeof plantShape>): [number, number][] {
      const onPlant: [number, number][] = [];
      for (const { plant: at, spot } of PLANT_SPOTS) {
        const dx = isoX(at[0], at[1]) - isoX(spot[0], spot[1]);
        const dy = isoY(at[0], at[1]) - isoY(spot[0], spot[1]);
        for (const roleKey of roleKeys.slice(0, 10)) {
          const { grid, anchorX, anchorY } = figureShape(lookOf(roleKey), "stand-back-water", 1);
          for (const pixel of pixelsOf(grid, F.water)) {
            const [x = 0, y = 0] = pixel.split(",").map(Number);
            // The pixel's middle on screen, mirrored, from the plant's anchor.
            onPlant.push([
              plant.anchorX + Math.floor(-(x - anchorX + 0.5) - dx),
              plant.anchorY + Math.floor(y - anchorY + 0.5 - dy),
            ]);
          }
        }
      }
      return onPlant;
    }

    it("waters a tall plant's pot top from the spot in front of it", () => {
      const plant = plantShape(true);
      const drops = dropsOnPlant(plant);
      expect(drops.length).toBeGreaterThanOrEqual(PLANT_SPOTS.length * 10);
      expect(new Set(drops.map(([x, y]) => plant.grid.get(x, y)))).toEqual(new Set([ART.potTop]));
      // Held up, no water falls.
      const { grid } = figureShape(lookOf("role-0"), "stand-back-water", 0);
      expect(pixelsOf(grid, F.water).size).toBe(0);
    });

    it("waters a short plant from over its pot", () => {
      const plant = plantShape(false);
      const pot = pixelsOf(plant.grid, ART.potTop, ART.potSide, ART.potRight);
      const potTopRow = Math.min(...[...pot].map((pixel) => Number(pixel.split(",")[1])));
      const lowest = Math.max(...dropsOnPlant(plant).map(([, y]) => y));
      expect(lowest).toBeLessThan(potTopRow);
    });

    it("draws a mug with coffee and a handle, and a paper cup with water", () => {
      for (const roleKey of roleKeys) {
        const look = lookOf(roleKey);
        for (const pose of ["stand-front-mug", "stand-front-mug-sip"] as const) {
          const { grid } = figureShape(look, pose, 0);
          expect(pixelsOf(grid, F.coffee).size).toBeGreaterThan(0);
          expect(pixelsOf(grid, F.mugShade).size).toBeGreaterThan(0);
          expect(pixelsOf(grid, F.water).size).toBe(0);
        }
        for (const pose of ["stand-front-cup", "stand-front-cup-sip"] as const) {
          const { grid } = figureShape(look, pose, 0);
          expect(pixelsOf(grid, F.water).size).toBeGreaterThan(0);
          expect(pixelsOf(grid, F.coffee).size).toBe(0);
        }
        // The sip raises the cup to the mouth: above the shoulders, beside the face.
        const shoulder = figureFrame(look, "stand-front-mug-sip", 0).torsoTop;
        const sip = figureShape(look, "stand-front-mug-sip", 0).grid;
        const cup = [...pixelsOf(sip, F.mug, F.coffee)].map((pixel) => Number(pixel.split(",")[1]));
        expect(Math.max(...cup)).toBeLessThan(shoulder);
      }
    });
  });

  describe("a glance", () => {
    const STILL_POSES: readonly FigurePose[] = [
      "stand-front",
      "stand-back",
      "stand-front-mug",
      "stand-front-mug-sip",
      "stand-front-cup",
      "stand-front-cup-sip",
      "stand-back-talk",
      "stand-back-read",
      "stand-back-water",
      "stand-front-panic",
      "sit-front",
      "sit-front-phone",
      "sit-back",
      "sit-back-raise",
      "sit-back-stretch",
    ];
    const looks = Array.from({ length: 40 }, (_, i) => lookOf(`role-${i}`));

    it.each(STILL_POSES)("turns the head of %s left or right, inside its grid", (pose) => {
      for (const look of looks) {
        const ahead = cellsOf(look, pose, 0);
        const left = cellsOf(look, pose, 0, "left");
        const right = cellsOf(look, pose, 0, "right");
        expect(left).not.toEqual(ahead);
        expect(right).not.toEqual(ahead);
        expect(right).not.toEqual(left);
        for (const glance of ["left", "right"] as const) {
          const { grid } = figureShape(look, pose, 0, glance);
          for (let x = 0; x < grid.width; x++) {
            for (const y of [0, grid.height - 1]) expect([0, F.outline]).toContain(grid.get(x, y));
          }
          for (let y = 0; y < grid.height; y++) {
            for (const x of [0, grid.width - 1]) expect([0, F.outline]).toContain(grid.get(x, y));
          }
        }
      }
    });

    it.each([
      "walk-front",
      "walk-back",
      "lie-front-push-up",
      "sit-back-sleep",
      "sit-back-play",
    ] as const)("leaves %s looking where it goes", (pose) => {
      const look = lookOf("developer");
      expect(cellsOf(look, pose, 1, "left")).toEqual(cellsOf(look, pose, 1));
      expect(cellsOf(look, pose, 1, "right")).toEqual(cellsOf(look, pose, 1));
    });

    it("is part of the shape's key, so each glance is cached apart", () => {
      const look = lookOf("developer");
      const keys = (["ahead", "left", "right"] as const).map((glance) =>
        figureShapeKey(look, "stand-front", 0, glance),
      );
      expect(new Set(keys).size).toBe(3);
      expect(figureShapeKey(look, "stand-front", 0)).toBe(keys[0]);
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
