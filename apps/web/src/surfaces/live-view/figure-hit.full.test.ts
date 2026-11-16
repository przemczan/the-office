import { describe, expect, it } from "vitest";
import { figureBoundsOf } from "./art/figures.ts";
import { type FigureHitBox, figureAnchor, figureAt } from "./figure-hit.ts";
import { createView } from "./view.ts";

// Two CSS pixels per art pixel, with the art's (0, 0) at the canvas' (0, 0).
const view = { ...createView(800, 600, 1), level: 2 };
/** An art pixel as the canvas point under it. */
const at = (x: number, y: number): { x: number; y: number } => ({ x: x * 2, y: y * 2 });

describe("the figure under the pointer", () => {
  const back: FigureHitBox = {
    roleKey: "developer",
    feet: { x: 100, y: 100 },
    depth: 1,
    bounds: figureBoundsOf("stand-front"),
  };
  const front: FigureHitBox = {
    roleKey: "reviewer",
    feet: { x: 104, y: 104 },
    depth: 2,
    bounds: figureBoundsOf("stand-front"),
  };

  it("is the front-most where two overlap", () => {
    expect(figureAt({ x: 204, y: 190 }, view, [back, front])).toBe("reviewer");
    expect(figureAt({ x: 204, y: 190 }, view, [front, back])).toBe("reviewer");
  });

  it("is the one behind where only it is", () => {
    expect(figureAt({ x: 186, y: 150 }, view, [back, front])).toBe("developer");
  });

  it("is nobody on a miss", () => {
    expect(figureAt({ x: 10, y: 10 }, view, [back, front])).toBeNull();
  });

  it("is never someone gone home, but whoever is behind them", () => {
    const gone: FigureHitBox = { ...front, gone: true };
    expect(figureAt({ x: 204, y: 190 }, view, [back, gone])).toBe("developer");
    expect(figureAt({ x: 208, y: 210 }, view, [gone])).toBeNull();
  });

  it("is found in a shorter box when seated", () => {
    const standing: FigureHitBox = { ...back, bounds: figureBoundsOf("stand-back") };
    const seated: FigureHitBox = { ...back, bounds: figureBoundsOf("sit-back") };
    // 24 art pixels above the feet: inside a standing box, above a seated one.
    const head = { x: 200, y: (100 - 24) * 2 };
    expect(figureAt(head, view, [standing])).toBe("developer");
    expect(figureAt(head, view, [seated])).toBeNull();
  });

  it("is found over the whole body of someone lying on the mat, head to toes", () => {
    // A push-up's middle at (100, 100): the head up and to the right, the feet down and to the left.
    const lying: FigureHitBox = { ...back, bounds: figureBoundsOf("lie-front-push-up") };
    expect(figureAt(at(110, 87), view, [lying])).toBe("developer");
    expect(figureAt(at(89, 105), view, [lying])).toBe("developer");
    expect(figureAt(at(100, 100), view, [lying])).toBe("developer");
    // Past its head and its feet, and well above it, where a standing figure's head would be.
    expect(figureAt(at(116, 87), view, [lying])).toBeNull();
    expect(figureAt(at(84, 105), view, [lying])).toBeNull();
    expect(figureAt(at(100, 77), view, [lying])).toBeNull();
    // A standing figure there is not hit as far out as the lying one's head.
    expect(
      figureAt(at(110, 87), view, [{ ...lying, bounds: figureBoundsOf("stand-front") }]),
    ).toBeNull();
  });

  it("anchors the tooltip from the head to just under the feet", () => {
    expect(figureAnchor(view, { x: 100, y: 100 })).toEqual({ x: 200, top: 152, bottom: 208 });
    expect(figureAnchor(view, { x: 100, y: 100 }, figureBoundsOf("sit-back"))).toEqual({
      x: 200,
      top: 152,
      bottom: 208,
    });
  });

  it("anchors a lying figure's tooltip lower, and its nameplate under its feet", () => {
    const anchor = figureAnchor(view, { x: 100, y: 100 }, figureBoundsOf("lie-front-push-up"));
    expect(anchor.top).toBeGreaterThan(152);
    expect(anchor.bottom).toBeGreaterThan(208);
  });
});
