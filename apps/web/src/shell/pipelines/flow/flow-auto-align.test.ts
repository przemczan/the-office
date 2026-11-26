import type { Route, Stage, StagePosition } from "@the-office/contracts";
import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import {
  alignedPositions,
  alignGraph,
  autoAligned,
  type ElkLayout,
  estimatedCardSize,
  type FlowCardSize,
} from "./flow-auto-align.ts";
import { listsRoutes } from "./flow-layout.ts";
import { asFlow, FAILED_CONDITION, isRouteBack, type FlowPositions } from "./flow-model.ts";
import { END_SIZE } from "./flow-snap.ts";

/** elkjs in-process: the browser runs the same layout in a Web Worker. */
const elk: ElkLayout = new ELK();

const changed = {
  combine: "all" as const,
  tests: [{ kind: "stage" as const, stage: null, is: "changed" as const }],
};

function agent(key: string, routes: Route[]): Stage {
  return {
    kind: "agent",
    key,
    name: key,
    optional: false,
    role: "developer",
    brief: "",
    session: "fresh",
    budget: 1000,
    routes,
  };
}

function script(key: string, routes: Route[]): Stage {
  return { kind: "script", key, name: key, optional: false, command: "test", routes };
}

/**
 * A branching Pipeline, placed badly on purpose (all on one spot): Tests goes back to Implement
 * when it fails, Review forks to a fix or Publish, the fix goes back to Tests, and Resolve loops on
 * itself.
 */
const branching: readonly Stage[] = asFlow(
  [
    agent("plan", [{ to: "implement", condition: null, limit: null }]),
    agent("implement", [{ to: "tests", condition: null, limit: null }]),
    script("tests", [
      { to: "implement", condition: FAILED_CONDITION, limit: 3 },
      { to: "review", condition: null, limit: null },
    ]),
    agent("review", [
      { to: "fix", condition: changed, limit: null },
      { to: "publish", condition: null, limit: null },
    ]),
    agent("fix", [{ to: "tests", condition: null, limit: 3 }]),
    script("publish", [
      { to: "resolve", condition: FAILED_CONDITION, limit: null },
      { to: null, condition: null, limit: null },
    ]),
    agent("resolve", [
      { to: "resolve", condition: FAILED_CONDITION, limit: 2 },
      { to: null, condition: null, limit: null },
    ]),
  ].map((stage) => ({ ...stage, position: { x: 0, y: 0 } })),
);

/** A straight line, the shape of a Pipeline converted from a plain list. */
const straight: readonly Stage[] = asFlow(
  ["plan", "tests", "publish"].map((key): Stage => ({
    kind: "gate",
    key,
    name: key,
    optional: false,
  })),
);

const sizeIn =
  (stages: readonly Stage[]) =>
  (stage: Stage): FlowCardSize =>
    estimatedCardSize(stage, listsRoutes(stage, stages));

interface Laid {
  readonly key: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function boxes(stages: readonly Stage[], laid: FlowPositions): Laid[] {
  const sizeOf = sizeIn(stages);
  return [
    ...stages.map((stage) => {
      const at = laid.stages.get(stage.key)!;
      const { width, height } = sizeOf(stage);
      return { key: stage.key, ...at, width, height };
    }),
    { key: null, ...laid.end!, width: END_SIZE, height: END_SIZE },
  ];
}

const overlap = (a: Laid, b: Laid): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("Auto-align", () => {
  for (const [name, stages] of [
    ["a branching Pipeline", branching],
    ["a straight line", straight],
  ] as const) {
    describe(`on ${name}`, () => {
      it("places every Stage and End in whole units, no two overlapping", async () => {
        const laid = await autoAligned(stages, sizeIn(stages), elk);
        expect([...laid.stages.keys()].toSorted()).toEqual(stages.map(({ key }) => key).toSorted());
        const all = boxes(stages, laid);
        for (const each of all) {
          expect(Number.isInteger(each.x) && Number.isInteger(each.y)).toBe(true);
        }
        for (const [index, one] of all.entries())
          for (const other of all.slice(index + 1)) expect(overlap(one, other)).toBe(false);
      });

      it("lays out left to right in the order, routes back leading left, End last", async () => {
        const laid = await autoAligned(stages, sizeIn(stages), elk);
        const all = boxes(stages, laid);
        const at = (key: string | null): Laid => all.find((each) => each.key === key)!;
        // Each route as where it leads stands: a route on goes to a later layer, past its Stage's
        // right edge; a route back leads left or to itself; End stands right of every final Stage.
        const wrong = stages.flatMap((stage) => {
          const from = at(stage.key);
          return (stage.routes ?? []).flatMap(({ to }) => {
            const target = at(to);
            const right =
              to === null
                ? target.x > from.x + from.width
                : isRouteBack(stages, stage.key, to)
                  ? target.x <= from.x
                  : target.x >= from.x + from.width;
            return right ? [] : [`${stage.key} → ${to ?? "End"}`];
          });
        });
        expect(wrong).toEqual([]);
        // The first Stage starts it, at the far left.
        expect(at(stages[0]!.key).x).toBe(Math.min(...all.map(({ x }) => x)));
      });

      it("gives the same layout every time", async () => {
        const once = await autoAligned(stages, sizeIn(stages), elk);
        const again = await autoAligned(stages, sizeIn(stages), elk);
        expect(again).toEqual(once);
      });
    });
  }

  it("gives each listing card's rows a fixed east port, End a last-layer node", () => {
    const graph = alignGraph(branching, sizeIn(branching));
    const tests = graph.children?.find(({ id }) => id === "tests");
    expect(tests?.ports?.map(({ id, y }) => [id, y])).toEqual([
      ["tests:0", 71],
      ["tests:1", 93],
    ]);
    expect(tests?.layoutOptions?.["elk.portConstraints"]).toBe("FIXED_POS");
    expect(graph.children?.[0]?.layoutOptions?.["elk.layered.layering.layerConstraint"]).toBe(
      "FIRST",
    );
    const end = graph.children?.at(-1);
    expect(end).toMatchObject({ width: 44, height: 44 });
    expect(end?.layoutOptions?.["elk.layered.layering.layerConstraint"]).toBe("LAST");
    expect(graph.layoutOptions?.["elk.layered.cycleBreaking.strategy"]).toBe("MODEL_ORDER");
    expect(graph.edges?.find(({ id }) => id === "tests>0")).toMatchObject({
      sources: ["tests:0"],
      targets: ["implement"],
    });
  });

  it("rounds to whole units, not the grid, with the layout's top-left at the origin", () => {
    const laid = alignedPositions({
      id: "flow",
      children: [
        { id: "a", x: 12.4, y: 30.6 },
        { id: "b", x: 320.5, y: 12 },
        { id: "flow:end", x: 610.49, y: 50 },
      ],
    });
    expect(Object.fromEntries(laid.stages)).toEqual<Record<string, StagePosition>>({
      a: { x: 0, y: 19 },
      b: { x: 308, y: 0 },
    });
    expect(laid.end).toEqual({ x: 598, y: 38 });
  });
});
