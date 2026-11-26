import type { FlowBox, FlowLine, FlowOrientation, MeasuredStage } from "../flow-layout.ts";
import { LIMIT_MARK, type RouteScene } from "./route-drawer.ts";

/**
 * The three test Pipelines of docs/design/pipeline-route-drawing.html ("The test Pipelines"), as
 * the canvas would measure them, wide and narrow: what each drawer's tests draw.
 */

interface FixtureStage {
  readonly key: string;
  /** How many routes its card lists. */
  readonly rows: number;
}

type FixtureLine = readonly [id: string, from: string, to: string | null, limit?: number];

interface FixtureView {
  readonly cardWidth: number;
  readonly at: Readonly<Record<string, readonly [number, number]>>;
  readonly end: FlowBox;
}

interface Fixture {
  readonly stages: readonly FixtureStage[];
  readonly lines: readonly FixtureLine[];
  readonly wide: FixtureView;
  readonly narrow: FixtureView;
}

export type FixtureName = "straight" | "loops" | "branching";

const FIXTURES: Readonly<Record<FixtureName, Fixture>> = {
  straight: {
    stages: [
      { key: "implement", rows: 0 },
      { key: "tests", rows: 0 },
      { key: "review", rows: 0 },
      { key: "publish", rows: 0 },
    ],
    lines: [
      ["a1", "implement", "tests"],
      ["a2", "tests", "review"],
      ["a3", "review", "publish"],
      ["a4", "publish", null],
    ],
    wide: {
      cardWidth: 232,
      at: { implement: [48, 80], tests: [356, 128], review: [664, 80], publish: [972, 80] },
      end: { x: 1280, y: 88, width: 44, height: 44 },
    },
    narrow: {
      cardWidth: 360,
      at: { implement: [16, 34], tests: [16, 128], review: [16, 222], publish: [16, 316] },
      end: { x: 16, y: 410, width: 360, height: 28 },
    },
  },
  loops: {
    stages: [
      { key: "implement", rows: 0 },
      { key: "tests", rows: 2 },
      { key: "review", rows: 3 },
      { key: "publish", rows: 2 },
    ],
    lines: [
      ["b1", "implement", "tests"],
      ["b2", "tests", "review"],
      ["b3", "tests", "implement", 3],
      ["b4", "review", "publish"],
      ["b5", "review", "implement", 2],
      ["b6", "review", "review", 1],
      ["b7", "publish", null],
      ["b8", "publish", "implement", 2],
    ],
    wide: {
      cardWidth: 232,
      at: { implement: [48, 96], tests: [356, 72], review: [664, 72], publish: [664, 300] },
      end: { x: 972, y: 342, width: 44, height: 44 },
    },
    narrow: {
      cardWidth: 136,
      at: { implement: [80, 34], tests: [80, 128], review: [80, 290], publish: [240, 290] },
      end: { x: 80, y: 486, width: 296, height: 28 },
    },
  },
  branching: {
    stages: [
      { key: "triage", rows: 3 },
      { key: "design", rows: 0 },
      { key: "implement", rows: 2 },
      { key: "review", rows: 2 },
    ],
    lines: [
      ["c1", "triage", "design"],
      ["c2", "triage", "implement"],
      ["c3", "triage", "review"],
      ["c4", "design", "implement"],
      ["c5", "implement", "review"],
      ["c6", "implement", "design", 2],
      ["c7", "review", null],
      ["c8", "review", "triage", 2],
    ],
    wide: {
      cardWidth: 232,
      at: { triage: [48, 120], design: [356, 48], implement: [356, 200], review: [664, 120] },
      end: { x: 972, y: 162, width: 44, height: 44 },
    },
    narrow: {
      cardWidth: 146,
      at: { triage: [60, 34], design: [60, 230], implement: [230, 230], review: [60, 392] },
      end: { x: 60, y: 554, width: 316, height: 28 },
    },
  },
};

export const FIXTURE_NAMES: readonly FixtureName[] = ["straight", "loops", "branching"];

/** A card with no rows is 60 high; each row adds 24 wide and 34 narrow, under a head of 52. */
function cardHeight(rows: number, orientation: FlowOrientation): number {
  return rows === 0 ? 60 : 52 + (orientation === "across" ? 24 : 34) * rows + 8;
}

export function fixtureScene(name: FixtureName, orientation: FlowOrientation): RouteScene {
  const fixture = FIXTURES[name];
  const view = orientation === "across" ? fixture.wide : fixture.narrow;
  const stages = new Map<string, MeasuredStage>(
    fixture.stages.map(({ key, rows }) => {
      const [x, y] = view.at[key]!;
      const box = { x, y, width: view.cardWidth, height: cardHeight(rows, orientation) };
      const rowCentres = Array.from({ length: rows }, (_, index) =>
        orientation === "across" ? y + 64 + 24 * index : x + view.cardWidth / 2,
      );
      return [key, { box, rowCentres }];
    }),
  );
  const routesOf = (key: string): readonly FixtureLine[] =>
    fixture.lines.filter(([, from]) => from === key);
  const lines = fixture.lines.map(([id, fromKey, to, limit]): FlowLine => {
    const routeIndex = routesOf(fromKey).findIndex(([each]) => each === id);
    const lists = (fixture.stages.find(({ key }) => key === fromKey)?.rows ?? 0) > 0;
    return {
      id,
      fromKey,
      to,
      routeIndex,
      port: lists ? routeIndex : undefined,
      look: "plain",
      limit: limit ?? null,
    };
  });
  return {
    orientation,
    stages,
    end: view.end,
    start: fixture.stages[0]?.key,
    lines,
    mark: LIMIT_MARK,
  };
}

/** A large Pipeline for the timing check: Stages in a grid, each with a route on, one down and one back. */
export function gridScene(stageCount: number, lineCount: number): RouteScene {
  const perRow = 6;
  const keys = Array.from({ length: stageCount }, (_, index) => `stage-${index}`);
  const stages = new Map<string, MeasuredStage>(
    keys.map((key, index) => {
      const box = {
        x: 48 + (index % perRow) * 308,
        y: 80 + Math.floor(index / perRow) * 200,
        width: 232,
        height: 108,
      };
      return [key, { box, rowCentres: [box.y + 64, box.y + 88] }];
    }),
  );
  const targets = (index: number): readonly (string | undefined)[] => [
    keys[index + 1],
    keys[index + perRow],
    keys[index - 2],
  ];
  const lines = keys
    .flatMap((fromKey, index) =>
      targets(index).flatMap((to, port): FlowLine[] =>
        to === undefined
          ? []
          : [
              {
                id: `${fromKey}:${port}`,
                fromKey,
                to,
                routeIndex: port,
                port: port < 2 ? port : undefined,
                look: "plain",
                limit: port === 2 ? 3 : null,
              },
            ],
      ),
    )
    .slice(0, lineCount);
  return {
    orientation: "across",
    stages,
    end: { x: 48 + perRow * 308, y: 112, width: 44, height: 44 },
    start: keys[0],
    lines,
    mark: LIMIT_MARK,
  };
}
