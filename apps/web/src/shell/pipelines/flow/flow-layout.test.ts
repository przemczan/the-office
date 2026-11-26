import type { Route, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  drawingStart,
  flowLines,
  flowRoom,
  listsRoutes,
  narrowBands,
  narrowLayout,
  NO_ROOM,
  type FlowBox,
  type FlowMeasure,
  orientationFor,
  startPath,
} from "./flow-layout.ts";
import { asFlow, FAILED_CONDITION } from "./flow-model.ts";

/** Where a test's Stage stands, on a grid of its own: columns 140 apart, rows 60 apart. */
interface At {
  readonly column: number;
  readonly row: number;
}

const positionAt = ({ column, row }: At) => ({ x: column * 140, y: row * 60 });

function gate(key: string, at: At, routes: Stage["routes"] = []): Stage {
  return { kind: "gate", key, name: key, optional: false, position: positionAt(at), routes };
}

function script(key: string, at: At, routes: Stage["routes"], goBackTo?: string): Stage {
  return {
    kind: "script",
    key,
    name: key,
    optional: false,
    command: "test",
    position: positionAt(at),
    routes: [
      ...(goBackTo === undefined ? [] : [{ to: goBackTo, condition: FAILED_CONDITION, limit: 2 }]),
      ...(routes ?? []),
    ],
  };
}

const plain = (to: string | null) => ({ to, condition: null, limit: null });

/** A Stage's box: 100 by 40 at its position. */
function boxAt({ position = { x: 0, y: 0 } }: Stage): FlowBox {
  return { ...position, width: 100, height: 40 };
}

/** Each Stage's box, and End right of the right-most. */
function measureOf(
  stages: readonly Stage[],
  rowCentres: Record<string, number[]> = {},
): FlowMeasure {
  const right = Math.max(0, ...stages.map((stage) => boxAt(stage).x + 140));
  return {
    stages: new Map(
      stages.map((stage) => [
        stage.key,
        { box: boxAt(stage), rowCentres: rowCentres[stage.key] ?? [] },
      ]),
    ),
    end: { x: right, y: 0, width: 60, height: 40 },
  };
}

describe("the canvas's orientation", () => {
  it("runs top to bottom when narrow, across from 560 and before it is laid out", () => {
    expect(orientationFor(390)).toBe("down");
    expect(orientationFor(559)).toBe("down");
    expect(orientationFor(560)).toBe("across");
    expect(orientationFor(900)).toBe("across");
    expect(orientationFor(0)).toBe("across");
  });
});

/** A Stage as the narrow view's bands read it: its key and position. */
const card = (key: string, x: number, y: number) => ({ key, position: { x, y } });

describe("the narrow view's bands", () => {
  it("are a converted Pipeline's columns, each column's rows top first", () => {
    const flow = asFlow([
      { kind: "gate", key: "plan", name: "Plan", optional: false, place: { column: 0, row: 0 } },
      { kind: "gate", key: "b", name: "B", optional: false, place: { column: 1, row: 1 } },
      { kind: "gate", key: "a", name: "A", optional: false, place: { column: 1, row: 0 } },
      { kind: "gate", key: "end", name: "Last", optional: false, place: { column: 2, row: 0 } },
    ]);
    expect(narrowBands(flow)).toEqual([["plan"], ["a", "b"], ["end"]]);
  });

  it("take in a Stage overlapping the band by half a card or more, else start a new one", () => {
    // Half a card is 116: overlapping by 132 joins, by 82 doesn't.
    expect(narrowBands([card("a", 0, 0), card("b", 100, 200)])).toEqual([["a", "b"]]);
    expect(narrowBands([card("a", 0, 0), card("b", 150, 200)])).toEqual([["a"], ["b"]]);
    // By x, whatever the order, and within a band by y, top first.
    expect(narrowBands([card("c", 700, 0), card("b", 20, -50), card("a", 0, 90)])).toEqual([
      ["b", "a"],
      ["c"],
    ]);
  });

  it("stand side by side two to a line, a third wrapping, End last across the width", () => {
    const layout = narrowLayout([["a"], ["b", "c", "d"], ["e"]]);
    expect([...layout.cells]).toEqual([
      ["a", { gridColumn: "1", gridRow: "1" }],
      ["b", { gridColumn: "1", gridRow: "2" }],
      ["c", { gridColumn: "2", gridRow: "2" }],
      ["d", { gridColumn: "1", gridRow: "3" }],
      ["e", { gridColumn: "1", gridRow: "4" }],
    ]);
    expect(layout.end).toEqual({ gridColumn: "1 / -1", gridRow: "5" });
    expect(layout.columns).toBe(2);
    expect(layout.bands.get("d")).toBe(1);
    expect(narrowLayout([["a"], ["b"]]).columns).toBe(1);
  });
});

describe("the lines to draw", () => {
  const tests = script("tests", { column: 0, row: 0 }, [
    { to: "review", condition: { combine: "all", tests: [] } },
    plain("publish"),
  ]);
  const review = gate("review", { column: 1, row: 0 }, [{ ...plain("publish"), limit: 2 }]);
  const publish = gate("publish", { column: 2, row: 0 }, [
    { to: "review", condition: null },
    plain(null),
  ]);
  const stages = [tests, review, publish];

  it("are every route, on and back alike, in the Pipeline's order, each with its port and limit", () => {
    expect(listsRoutes(tests, stages)).toBe(true);
    expect(listsRoutes(review, stages)).toBe(true);
    expect(listsRoutes(gate("one", { column: 0, row: 0 }, [plain(null)]))).toBe(false);
    expect(flowLines(stages).map(({ id, to, port, limit }) => [id, to, port, limit])).toEqual([
      ["tests:0", "review", 0, null],
      ["tests:1", "publish", 1, null],
      ["review:0", "publish", 0, 2],
      // Publish's route back to Review, with no limit given, takes the default of 3.
      ["publish:0", "review", 0, 3],
      ["publish:1", null, 1, null],
    ]);
  });

  it("keep a route back to its own Stage, from a Stage that goes back first", () => {
    const own = script("tests", { column: 0, row: 0 }, [plain(null)], "tests");
    expect(flowLines([own]).map(({ id, to, limit }) => [id, to, limit])).toEqual([
      ["tests:0", "tests", 2],
      ["tests:1", null, null],
    ]);
  });

  it("end with a Proposal's proposed and taken-away routes, which no press picks", () => {
    const proposed = new Map<string, readonly Route[]>([
      ["review", [{ to: "tests", condition: null, limit: 4 }]],
    ]);
    const takenAway = new Map<string, readonly Route[]>([["tests", [plain("publish")]]]);
    const lines = flowLines(stages, { proposed, takenAway });
    expect(
      lines
        .slice(5)
        .map(({ id, look, routeIndex, port, limit }) => [id, look, routeIndex, port, limit]),
    ).toEqual([
      ["proposed:review:0", "proposed", undefined, undefined, 4],
      ["taken-away:tests:0", "taken-away", undefined, undefined, null],
    ]);
  });
});

describe("the room the lines take", () => {
  // Cards from (0, 0) to End's right edge, 340 by 40.
  const stages = [gate("a", { column: 0, row: 0 }), gate("b", { column: 1, row: 0 })];
  const measure = measureOf(stages);

  it("is how far the drawing reaches past the box around the cards on each side", () => {
    expect(flowRoom({ x: -12.5, y: -30, width: 400, height: 100 }, measure)).toEqual({
      top: 30,
      right: 48,
      bottom: 30,
      left: 13,
    });
  });

  it("is none where the drawing stays inside the cards' box, or nothing is drawn or measured", () => {
    expect(flowRoom({ x: 10, y: 0, width: 100, height: 40 }, measure)).toEqual(NO_ROOM);
    expect(flowRoom(undefined, measure)).toEqual(NO_ROOM);
    expect(
      flowRoom({ x: -50, y: -50, width: 10, height: 10 }, { stages: new Map(), end: undefined }),
    ).toEqual(NO_ROOM);
  });
});

describe("where the walk starts", () => {
  const stages = [gate("a", { column: 1, row: 1 })];
  const box: FlowBox = { x: 140, y: 60, width: 100, height: 40 };

  it("comes into the first Stage's left edge across, and its top edge down", () => {
    expect(startPath(stages[0], measureOf(stages), "across")).toEqual({
      dot: { x: 116, y: 80 },
      d: "M120,80 L134,80",
      arrow: "140,80 133,76 133,84",
    });
    expect(startPath(stages[0], measureOf(stages), "down")).toEqual({
      dot: { x: 190, y: 36 },
      d: "M190,40 L190,54",
      arrow: "190,60 186,53 194,53",
    });
    expect(startPath(undefined, measureOf(stages), "across")).toBeUndefined();
  });

  it("and a route being drawn leaves the Stage's right edge across, its bottom edge down", () => {
    expect(drawingStart(box, "across")).toEqual({ x: 240, y: 80 });
    expect(drawingStart(box, "down")).toEqual({ x: 190, y: 100 });
  });
});
