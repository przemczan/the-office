import { describe, expect, it } from "vitest";
import type { ArtRect } from "./office-geometry.ts";
import {
  type View,
  canZoomIn,
  canZoomOut,
  clampView,
  createView,
  fitView,
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
  it("picks the largest level that fits inside the margins and centres the office", () => {
    const view = fitted();
    expect(view.level).toBe(1);
    expect(view.minLevel).toBe(1);
    expect(view.framing).toEqual({ kind: "office" });
    expect(view.offsetX).toBe(200);
    expect(view.offsetY).toBe(146);
  });

  it("uses whole device pixels on a dense screen", () => {
    const view = fitted(2);
    expect(view.level).toBe(3);
    expect(zoomPercent(view)).toBe(150);
    expect(view.offsetX).toBe(100);
    expect(view.offsetY).toBe(71);
  });

  it("falls back to half a pixel when the office doesn't fit at one", () => {
    const view = fitView(createView(300, 300, 1), office);
    expect(view.level).toBe(0.5);
  });
});

describe("panning", () => {
  it("keeps at least 80 pixels of the office in view in all four directions", () => {
    const start = fitted();
    const left = panBy(start, -5000, 0, office);
    expect(left.offsetX + office.width * scaleOf(left)).toBe(80);
    const right = panBy(start, 5000, 0, office);
    expect(right.offsetX).toBe(800 - 80);
    const up = panBy(start, 0, -5000, office);
    expect(up.offsetY + office.height * scaleOf(up)).toBe(80);
    const down = panBy(start, 0, 5000, office);
    expect(down.offsetY).toBe(600 - 80);
    expect(down.framing).toEqual({ kind: "user" });
  });

  it("leaves a view that keeps enough of the office alone", () => {
    const view = panBy(fitted(), 30, -20, office);
    expect(clampView(view, office)).toBe(view);
    expect(view.offsetX).toBe(230);
  });
});

describe("zooming", () => {
  it("keeps the art point under the anchor where it is", () => {
    const start = fitted();
    const before = artUnder(start, 300, 250);
    const zoomed = zoomTo(start, 3, office, 300, 250);
    expect(zoomed.level).toBe(3);
    expect(artUnder(zoomed, 300, 250)).toEqual(before);
    expect(zoomed.framing).toEqual({ kind: "user" });
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

  it("snaps a pinch to the nearest reachable level", () => {
    const start = fitted();
    expect(pinchTo(start, 2.7, 400, 300, office).level).toBe(3);
    expect(pinchTo(start, 0.2, 400, 300, office)).toBe(start);
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
    expect(artUnder(resized, 500, 350)).toEqual(middle);
    expect(resized.framing).toEqual({ kind: "user" });
  });
});
