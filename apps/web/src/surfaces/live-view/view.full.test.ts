import { describe, expect, it } from "vitest";
import type { ArtRect } from "./office-geometry.ts";
import {
  type View,
  canZoomIn,
  canZoomOut,
  clampView,
  createView,
  drawnLevel,
  fitView,
  isWholeLevel,
  panBy,
  pinchTo,
  resizeView,
  scaleOf,
  zoomLevels,
  zoomPercent,
  zoomStep,
  zoomTo,
} from "./view.ts";

const office: ArtRect = { x: 0, y: 0, width: 400, height: 300 };

function fitted(devicePixelRatio = 1): View {
  return fitView(createView(800, 600, devicePixelRatio), office);
}

function artUnder(view: View, x: number, y: number) {
  return { x: (x - view.offsetX) / scaleOf(view), y: (y - view.offsetY) / scaleOf(view) };
}

describe("the Live view's zoom levels", () => {
  it("are whole device pixels, with half a pixel only as the first, up to six CSS pixels", () => {
    expect(zoomLevels(1)).toEqual([0.5, 1, 2, 3, 4, 5, 6]);
    expect(zoomLevels(2)).toEqual([0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});

describe("fitting the office", () => {
  it("takes the largest scale that fits inside the margins, in-between steps too, and centres the office", () => {
    const view = fitted();
    expect(view.level).toBeCloseTo(1.6);
    expect(view.minLevel).toBe(view.level);
    expect(zoomPercent(view)).toBe(160);
    expect(view.framing).toEqual({ kind: "office" });
    expect(view.offsetX).toBeCloseTo(80);
    expect(view.offsetY).toBeCloseTo(56);
  });

  it("fills a wide screen exactly rather than dropping to the step below", () => {
    const view = fitView(createView(2560, 1221, 1), office);
    expect(zoomPercent(view)).toBe(367);
    expect(isWholeLevel(view.level)).toBe(false);
    expect(drawnLevel(view.level)).toBe(4);
  });

  it("counts device pixels on a dense screen", () => {
    const view = fitted(2);
    expect(view.level).toBeCloseTo(3.2);
    expect(zoomPercent(view)).toBe(160);
    expect(view.offsetX).toBeCloseTo(80);
    expect(view.offsetY).toBeCloseTo(56);
  });

  it("lands on a whole step when the office fits one exactly", () => {
    const view = fitView(createView(832, 720, 1), office);
    expect(view.level).toBe(2);
    expect(isWholeLevel(view.level)).toBe(true);
  });

  it("never goes under half a pixel, nor over the top step", () => {
    expect(fitView(createView(200, 200, 1), office).level).toBe(0.5);
    expect(fitView(createView(300, 300, 1), office).level).toBeCloseTo(0.6);
    expect(fitView(createView(8000, 6000, 1), office).level).toBe(6);
  });
});

describe("the step the art is drawn at", () => {
  it("is the level itself at a step, else the next whole step up", () => {
    expect(drawnLevel(0.5)).toBe(0.5);
    expect(drawnLevel(3)).toBe(3);
    expect(drawnLevel(0.6)).toBe(1);
    expect(drawnLevel(3.67)).toBe(4);
  });
});

describe("panning", () => {
  it("keeps at least 80 pixels of the office in view in all four directions", () => {
    const start = fitted();
    const left = panBy(start, -5000, 0, office);
    expect(left.offsetX + office.width * scaleOf(left)).toBeCloseTo(80);
    const right = panBy(start, 5000, 0, office);
    expect(right.offsetX).toBeCloseTo(800 - 80);
    const up = panBy(start, 0, -5000, office);
    expect(up.offsetY + office.height * scaleOf(up)).toBeCloseTo(80);
    const down = panBy(start, 0, 5000, office);
    expect(down.offsetY).toBeCloseTo(600 - 80);
    expect(down.framing).toEqual({ kind: "user" });
  });

  it("leaves a view that keeps enough of the office alone", () => {
    const view = panBy(fitted(), 30, -20, office);
    expect(clampView(view, office)).toBe(view);
    expect(view.offsetX).toBeCloseTo(110);
  });
});

describe("zooming", () => {
  it("keeps the art point under the anchor where it is", () => {
    const start = fitted();
    const before = artUnder(start, 300, 250);
    const zoomed = zoomTo(start, 3, office, 300, 250);
    expect(zoomed.level).toBe(3);
    expect(artUnder(zoomed, 300, 250).x).toBeCloseTo(before.x);
    expect(artUnder(zoomed, 300, 250).y).toBeCloseTo(before.y);
    expect(zoomed.framing).toEqual({ kind: "user" });
  });

  it("steps from the whole office to the whole steps either side, and back to it", () => {
    const start = fitted();
    const inOnce = zoomStep(start, 1, office);
    expect(inOnce.level).toBe(2);
    expect(canZoomOut(inOnce)).toBe(true);
    const back = zoomStep(inOnce, -1, office);
    expect(back.level).toBe(start.level);
    expect(canZoomOut(back)).toBe(false);
    expect(zoomStep(zoomStep(inOnce, 1, office), -1, office).level).toBe(2);
  });

  it("steps no further out than the whole office and no further in than the top level", () => {
    const start = fitted();
    expect(canZoomOut(start)).toBe(false);
    expect(zoomStep(start, -1, office)).toBe(start);
    let view = start;
    for (let step = 0; step < 10; step++) view = zoomStep(view, 1, office);
    expect(view.level).toBe(6);
    expect(canZoomIn(view)).toBe(false);
    expect(zoomStep(view, 1, office)).toBe(view);
    expect(zoomStep(view, -1, office).level).toBe(5);
  });

  it("snaps a pinch to the nearest reachable level: a whole step or the whole office", () => {
    const start = fitted();
    expect(pinchTo(start, 2.7, 400, 300, office).level).toBe(4);
    expect(pinchTo(start, 1.3, 400, 300, office).level).toBe(2);
    expect(pinchTo(start, 1.1, 400, 300, office)).toBe(start);
    expect(pinchTo(start, 0.2, 400, 300, office)).toBe(start);
    const zoomedIn = zoomTo(start, 3, office);
    expect(pinchTo(zoomedIn, 0.55, 400, 300, office).level).toBe(start.level);
    expect(pinchTo(zoomedIn, 0.1, 400, 300, office).level).toBe(start.level);
  });
});

describe("resizing", () => {
  it("fits again while framed on the office", () => {
    const view = resizeView(fitted(), 1600, 1200, 1, office);
    expect(view).toEqual(fitView(createView(1600, 1200, 1), office));
  });

  it("keeps the middle of the view once the user moved it", () => {
    const moved = zoomTo(fitted(), 2, office, 350, 260);
    const middle = artUnder(moved, 400, 300);
    const resized = resizeView(moved, 1000, 700, 1, office);
    expect(resized.level).toBe(2);
    expect(artUnder(resized, 500, 350).x).toBeCloseTo(middle.x);
    expect(artUnder(resized, 500, 350).y).toBeCloseTo(middle.y);
    expect(resized.framing).toEqual({ kind: "user" });
  });

  it("follows the whole office's new level when moved at it, and never stays further out", () => {
    const panned = panBy(fitted(), 30, 20, office);
    const resized = resizeView(panned, 1000, 700, 1, office);
    expect(resized.minLevel).toBeCloseTo(580 / 300);
    expect(resized.level).toBe(resized.minLevel);
    const grown = resizeView(zoomTo(fitted(), 2, office), 1600, 1200, 1, office);
    expect(grown.minLevel).toBeCloseTo(3.6);
    expect(grown.level).toBe(grown.minLevel);
  });
});
