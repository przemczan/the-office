import { describe, expect, it } from "vitest";
import type { FlowBox } from "./flow-layout.ts";
import {
  CLEARANCE,
  clearSpot,
  derivedEndPosition,
  type FlowCard,
  freeSpotBeside,
  snapMove,
  steppedPast,
} from "./flow-snap.ts";

const CARD = { width: 232, height: 72 };
const box = (x: number, y: number, size = CARD): FlowBox => ({ x, y, ...size });
const card = (key: string | null, x: number, y: number): FlowCard => ({ key, box: box(x, y) });
const AT_100 = { zoom: 1, free: false };

/** Whether two boxes come nearer each other than `by`. */
function within(one: FlowBox, other: FlowBox, by: number): boolean {
  return (
    one.x < other.x + other.width + by &&
    other.x < one.x + one.width + by &&
    one.y < other.y + other.height + by &&
    other.y < one.y + one.height + by
  );
}

describe("a dragged Stage's snapping", () => {
  it("rounds to the 16-unit grid when no other Stage's line is in reach", () => {
    expect(snapMove({ x: 37, y: 21 }, CARD, [], AT_100)).toEqual({
      position: { x: 32, y: 16 },
      guides: [],
    });
    expect(snapMove({ x: -9, y: -25 }, CARD, [], AT_100).position).toEqual({ x: -16, y: -32 });
  });

  it("snaps each axis to another Stage's edge, with a guide from the card to that Stage", () => {
    const snapped = snapMove({ x: 405, y: 300 }, CARD, [box(400, 0)], AT_100);
    // Its left edge onto the other's; no line in reach on y, so y goes to the grid.
    expect(snapped.position).toEqual({ x: 400, y: 304 });
    expect(snapped.guides).toEqual([{ axis: "x", at: 400, from: -10, to: 386 }]);
  });

  it("snaps a centre onto a centre, and the nearest line wins", () => {
    const narrow = { width: 100, height: 40 };
    // Its centre (x + 50) 4 from the other's centre, 516.
    expect(snapMove({ x: 470, y: 0 }, narrow, [box(400, 300)], AT_100).position.x).toBe(466);
    // Top 6 from one Stage's top, bottom 3 from another's: the bottom wins.
    const snapped = snapMove({ x: 0, y: 106 }, CARD, [box(600, 100), box(900, 181)], AT_100);
    expect(snapped.position.y).toBe(109);
    expect(snapped.guides).toEqual([{ axis: "y", at: 181, from: -10, to: 1142 }]);
  });

  it("reaches 8 screen pixels, so further in canvas units zoomed out", () => {
    const others = [box(400, 0)];
    // 12 units off: out of reach at 100%, the grid wins; at 50% that is 6 pixels.
    expect(snapMove({ x: 412, y: 0 }, CARD, others, AT_100).position.x).toBe(416);
    expect(snapMove({ x: 412, y: 0 }, CARD, others, { zoom: 0.5, free: false }).position.x).toBe(
      400,
    );
    expect(
      snapMove({ x: 412, y: 200 }, CARD, others, { zoom: 0.25, free: false }).guides,
    ).toHaveLength(1);
  });

  it("places it freely with Alt: no grid, no guides, whole units", () => {
    expect(snapMove({ x: 405.6, y: 21.2 }, CARD, [box(400, 0)], { zoom: 1, free: true })).toEqual({
      position: { x: 406, y: 21 },
      guides: [],
    });
  });

  it("keeps it in line with Shift, along the way it moved further", () => {
    const along = { x: 100, y: 100 };
    expect(snapMove({ x: 180, y: 110 }, CARD, [], { ...AT_100, along }).position).toEqual({
      x: 176,
      y: 100,
    });
    expect(snapMove({ x: 105, y: 190 }, CARD, [], { ...AT_100, along }).position).toEqual({
      x: 100,
      y: 192,
    });
    // With Alt too, it keeps its line, unsnapped.
    expect(snapMove({ x: 183, y: 110 }, CARD, [], { zoom: 1, free: true, along }).position).toEqual(
      { x: 183, y: 100 },
    );
  });
});

describe("where a dragged Stage lands", () => {
  it("is where it was dropped when that covers no card", () => {
    expect(clearSpot(box(0, 200), [card("a", 0, 0)])).toEqual({
      position: { x: 0, y: 200 },
      covered: undefined,
    });
  });

  it("is the nearest free grid spot, never within 16 of a card, when it would cover one", () => {
    const others = [card("a", 0, 0)];
    const landing = clearSpot(box(10, 10), others);
    expect(landing.covered?.key).toBe("a");
    expect(landing.position).toEqual({ x: 16, y: 96 });

    const crowded = [card("a", 0, 0), card("b", 0, 96), card("c", 264, 0), card(null, 0, -112)];
    const spot = clearSpot(box(20, 40), crowded);
    expect(spot.covered).toBeDefined();
    for (const { box: other } of crowded)
      expect(within({ ...box(0, 0), ...spot.position }, other, CLEARANCE)).toBe(false);
  });
});

describe("Shift + an arrow", () => {
  it("moves a Stage one grid step, past any card in the way", () => {
    expect(steppedPast(box(0, 0), [], { dx: 0, dy: -1 })).toEqual({ x: 0, y: -16 });
    // A card 18 to the right: a step would bring it within 16, so it steps on past the card.
    expect(steppedPast(box(0, 0), [card("a", 250, 0)], { dx: 1, dy: 0 })).toEqual({
      x: 512,
      y: 0,
    });
  });
});

describe("a Stage without a position", () => {
  it("stands 76 right of the Stage before it, at its y, down by 16 until it covers no card", () => {
    expect(freeSpotBeside(undefined, CARD, [])).toEqual({ x: 0, y: 0 });
    expect(freeSpotBeside(box(0, 40), CARD, [box(0, 40)])).toEqual({ x: 308, y: 40 });
    expect(freeSpotBeside(box(0, 0), CARD, [box(0, 0), box(308, 0)])).toEqual({ x: 308, y: 80 });
  });
});

describe("End without a position", () => {
  it("stands 76 right of the right-most Stage, level with the first final Stage's route to it", () => {
    const end = derivedEndPosition([
      { box: box(0, 0), routes: [{ to: "b", condition: null }], rowCentres: [] },
      {
        box: box(308, 40, { width: 232, height: 126 }),
        routes: [
          { to: null, condition: null },
          { to: "a", condition: null },
        ],
        rowCentres: [70, 92],
      },
      { box: box(700, 300), routes: [{ to: null, condition: null }], rowCentres: [] },
    ]);
    // Right of the right-most edge, 932; level with the second Stage's first row, at 110.
    expect(end).toEqual({ x: 1008, y: 88 });
    // A final Stage that lists no rows: level with its middle.
    expect(
      derivedEndPosition([
        { box: box(0, 10), routes: [{ to: null, condition: null }], rowCentres: [] },
      ]),
    ).toEqual({ x: 308, y: 24 });
  });
});
