import { describe, expect, it } from "vitest";
import {
  AT_START,
  centredOn,
  clampedView,
  fittedView,
  namesOnlyAt,
  overflows,
  steppedZoom,
  viewportHeight,
  withBoxInView,
  zoomedAround,
} from "./flow-zoom.ts";

const viewport = { width: 800, height: 400 };
const large = { width: 2000, height: 1000 };
const small = { width: 300, height: 200 };

describe("the flow canvas's view", () => {
  it("steps through 25, 33, 50, 67, 75, 90 and 100%, and no further", () => {
    expect(steppedZoom(1, 1)).toBeUndefined();
    expect(steppedZoom(1, -1)).toBe(0.9);
    expect(steppedZoom(0.6, -1)).toBe(0.5);
    expect(steppedZoom(0.6, 1)).toBe(0.67);
    expect(steppedZoom(0.25, -1)).toBeUndefined();
  });

  it("shows a card's name only under 60%", () => {
    expect(namesOnlyAt(0.59)).toBe(true);
    expect(namesOnlyAt(0.6)).toBe(false);
  });

  it("fits a large Pipeline whole, centred, and never enlarges one that fits past 100%", () => {
    const fitted = fittedView(viewport, large);
    expect(fitted.zoom).toBeCloseTo((400 - 56) / 1000);
    expect(fitted.x).toBeCloseTo((800 - 2000 * fitted.zoom) / 2);
    expect(fittedView(viewport, small).zoom).toBe(1);
  });

  it("fits no further out than 25%", () => {
    expect(fittedView(viewport, { width: 20_000, height: 400 }).zoom).toBe(0.25);
  });

  it("keeps a Pipeline that fits inside the viewport, and one that doesn't within reach", () => {
    expect(clampedView({ zoom: 1, x: -50, y: 500 }, viewport, small)).toEqual({
      zoom: 1,
      x: 0,
      y: 200,
    });
    expect(clampedView({ zoom: 1, x: -5000, y: 300 }, viewport, large)).toEqual({
      zoom: 1,
      x: 800 - 2000 - 56,
      y: 56,
    });
  });

  it("zooms around the pointer, which stays over the same part of the Pipeline", () => {
    const zoomed = zoomedAround(
      { zoom: 1, x: -400, y: -200 },
      0.5,
      { x: 400, y: 200 },
      viewport,
      large,
    );
    // The point under the pointer was the content's (800, 400); at 50% it is still under it.
    expect(zoomed.x + 800 * zoomed.zoom).toBeCloseTo(400);
    expect(zoomed.y + 400 * zoomed.zoom).toBeCloseTo(200);
  });

  it("centres on a point the Overview asks for", () => {
    const centred = centredOn(AT_START, { x: 1000, y: 500 }, viewport, large);
    expect(centred).toEqual({ zoom: 1, x: 400 - 1000, y: 200 - 500 });
  });

  it("brings a picked Stage into view, and stays where it is when it already is", () => {
    const box = { x: 1500, y: 100, width: 232, height: 80 };
    const moved = withBoxInView(AT_START, box, viewport, large);
    expect(moved.x + (box.x + box.width) * moved.zoom).toBe(800 - 40);
    const inView = { x: 100, y: 100, width: 232, height: 80 };
    expect(withBoxInView(AT_START, inView, viewport, large)).toBe(AT_START);
  });

  it("says whether the Pipeline runs past the viewport, when the Overview shows", () => {
    expect(overflows(AT_START, viewport, large)).toBe(true);
    expect(overflows(AT_START, viewport, small)).toBe(false);
    expect(overflows({ zoom: 0.25, x: 0, y: 0 }, viewport, large)).toBe(false);
  });

  it("is as tall as the Pipeline at 100%, at least 300 and at most 62% of the window", () => {
    expect(viewportHeight(120, 1000)).toBe(300);
    expect(viewportHeight(480, 1000)).toBe(480);
    expect(viewportHeight(2000, 1000)).toBe(620);
  });
});
