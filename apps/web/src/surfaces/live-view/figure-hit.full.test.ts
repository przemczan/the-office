import { describe, expect, it } from "vitest";
import { type FigureHitBox, figureAnchor, figureAt } from "./figure-hit.ts";
import { createView } from "./view.ts";

// Two CSS pixels per art pixel, with the art's (0, 0) at the canvas' (0, 0).
const view = { ...createView(800, 600, 1), level: 2 };

describe("the figure under the pointer", () => {
  const back: FigureHitBox = {
    roleKey: "developer",
    feet: { x: 100, y: 100 },
    depth: 1,
    seated: false,
  };
  const front: FigureHitBox = {
    roleKey: "reviewer",
    feet: { x: 104, y: 104 },
    depth: 2,
    seated: false,
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
    const standing: FigureHitBox = { ...back, seated: false };
    const seated: FigureHitBox = { ...back, seated: true };
    // 24 art pixels above the feet: inside a standing box, above a seated one.
    const head = { x: 200, y: (100 - 24) * 2 };
    expect(figureAt(head, view, [standing])).toBe("developer");
    expect(figureAt(head, view, [seated])).toBeNull();
  });

  it("anchors the tooltip from the head to just under the feet", () => {
    expect(figureAnchor(view, { x: 100, y: 100 })).toEqual({ x: 200, top: 152, bottom: 208 });
  });
});
