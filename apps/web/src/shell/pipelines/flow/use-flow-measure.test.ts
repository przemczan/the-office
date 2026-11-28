import { describe, expect, it } from "vitest";
import type { FlowBox, MeasuredStage } from "./flow-layout.ts";
import { type FlowView, sameView } from "./use-flow-measure.ts";

const box = (x: number, width = 232): FlowBox => ({ x, y: 92, width, height: 46.39 });

function viewOf(stages: readonly (readonly [string, MeasuredStage])[]): FlowView {
  return { width: 1572, height: 389, measure: { stages: new Map(stages), end: box(1282, 44) } };
}

const READ = viewOf([
  ["implement", { box: box(34), rowCentres: [] }],
  ["tests", { box: box(1326.004), rowCentres: [309.13, 339.32] }],
]);

function stagesWith(rowCentres: readonly number[]): FlowView {
  return viewOf([
    ["implement", { box: box(34), rowCentres: [] }],
    ["tests", { box: box(1326.004), rowCentres }],
  ]);
}

describe("sameView", () => {
  it("holds for a read that lands across a hundredth's rounding boundary", () => {
    // At a fractional zoom the same card read 1326.004, then 1326.006: rounded, those flip between
    // 1326 and 1326.01 on every read, which rendered and measured again without end.
    const again = viewOf([
      ["implement", { box: box(34.003), rowCentres: [] }],
      ["tests", { box: box(1326.006), rowCentres: [309.136, 339.324] }],
    ]);
    expect(sameView(READ, again)).toBe(true);
  });

  it("tells a card moved or resized by a pixel", () => {
    const moved = viewOf([
      ["implement", { box: box(35), rowCentres: [] }],
      ["tests", { box: box(1326.004), rowCentres: [309.13, 339.32] }],
    ]);
    const wider = viewOf([
      ["implement", { box: box(34, 233), rowCentres: [] }],
      ["tests", { box: box(1326.004), rowCentres: [309.13, 339.32] }],
    ]);
    expect(sameView(READ, moved)).toBe(false);
    expect(sameView(READ, wider)).toBe(false);
  });

  it("tells a route row's centre moved, added or taken away", () => {
    expect(sameView(READ, stagesWith([309.13, 340.32]))).toBe(false);
    expect(sameView(READ, stagesWith([309.13]))).toBe(false);
    expect(sameView(READ, stagesWith([309.13, 339.32, 369.5]))).toBe(false);
  });

  it("tells another set or order of Stages, and End appearing", () => {
    const [implement, tests] = [...READ.measure.stages];
    if (!implement || !tests) throw new Error("READ has two Stages");
    expect(sameView(READ, viewOf([implement]))).toBe(false);
    expect(sameView(READ, viewOf([tests, implement]))).toBe(false);
    expect(sameView(READ, viewOf([implement, ["publish", tests[1]]]))).toBe(false);
    const noEnd: FlowView = { ...READ, measure: { ...READ.measure, end: undefined } };
    expect(sameView(noEnd, READ)).toBe(false);
  });

  it("tells the canvas resized", () => {
    expect(sameView(READ, { ...READ, width: 1573 })).toBe(false);
  });
});
