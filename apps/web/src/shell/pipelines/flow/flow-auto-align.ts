import type { Stage, StagePosition } from "@the-office/contracts";
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from "elkjs/lib/elk-api.js";
import type { FlowPositions } from "./flow-model.ts";
import { CARD_WIDTH, END_SIZE, estimatedCardHeight } from "./flow-snap.ts";

/**
 * Auto-align (docs/design/pipeline-free-placement.html, "Auto-align"): the whole Pipeline laid out
 * as a layered diagram from left to right by elkjs, in the Pipeline's order, so a route back is
 * exactly a route that runs against it. Building the graph and reading its result are pure; the
 * layout itself runs wherever `ElkLayout` does (a Web Worker in the browser, `elk-in-worker.ts`).
 * Only the positions are used: the editor draws the lines itself.
 */

/** A card as Auto-align lays it out, at 100%. */
export interface FlowCardSize {
  readonly width: number;
  readonly height: number;
  /** The middle of each route row the card lists, from its top; none when it lists none. */
  readonly rowCentres: readonly number[];
}

/** What lays a graph out: elkjs, in a worker or in-process. */
export interface ElkLayout {
  readonly layout: (graph: ElkNode) => Promise<ElkNode>;
}

/** End's node; a Stage's key is lower-case letters, digits and "-", so it can't be one. */
const END_NODE = "flow:end";

/** The layout rules, as elkjs options (the design's table). */
export const AUTO_ALIGN_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.spacing.nodeNodeBetweenLayers": "76",
  "elk.spacing.nodeNode": "28",
  "elk.layered.spacing.edgeNodeBetweenLayers": "20",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
  "elk.randomSeed": "1",
};

const LAYER = "elk.layered.layering.layerConstraint";

/**
 * The graph to lay out: the Stages in the Pipeline's order at their sizes, the first in the first
 * layer, End a 44 × 44 node in the last; one east port per route row a card lists, at its row; an
 * edge for every route, from its row's port where the card lists its routes.
 */
export function alignGraph(
  stages: readonly Stage[],
  sizeOf: (stage: Stage) => FlowCardSize,
): ElkNode {
  const keys = new Set(stages.map(({ key }) => key));
  const children = stages.map((stage, index): ElkNode => {
    const { width, height, rowCentres } = sizeOf(stage);
    const ports = rowCentres.map((y, row): ElkPort => ({
      id: portId(stage.key, row),
      x: width,
      y,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": "EAST" },
    }));
    return {
      id: stage.key,
      width,
      height,
      ...(ports.length > 0 && { ports }),
      layoutOptions: {
        ...(index === 0 && { [LAYER]: "FIRST" }),
        ...(ports.length > 0 && { "elk.portConstraints": "FIXED_POS" }),
      },
    };
  });
  const edges = stages.flatMap((stage) => {
    const { key, routes = [] } = stage;
    const rows = sizeOf(stage).rowCentres.length;
    return routes.flatMap(({ to }, row): ElkExtendedEdge[] =>
      to === null || keys.has(to)
        ? [
            {
              id: `${key}>${row}`,
              sources: [row < rows ? portId(key, row) : key],
              targets: [to ?? END_NODE],
            },
          ]
        : [],
    );
  });
  return {
    id: "flow",
    layoutOptions: AUTO_ALIGN_OPTIONS,
    children: [
      ...children,
      { id: END_NODE, width: END_SIZE, height: END_SIZE, layoutOptions: { [LAYER]: "LAST" } },
    ],
    edges,
  };
}

const portId = (key: string, row: number): string => `${key}:${row}`;

/**
 * Every Stage's position and End's from the laid-out graph, in whole units (not the grid, so the
 * lines it straightened stay straight), the whole layout's top-left at the origin.
 */
export function alignedPositions(result: ElkNode): FlowPositions {
  const nodes = result.children ?? [];
  const left = Math.min(...nodes.map(({ x = 0 }) => x));
  const top = Math.min(...nodes.map(({ y = 0 }) => y));
  const at = ({ x = 0, y = 0 }: ElkNode): StagePosition => ({
    x: Math.round(x - left),
    y: Math.round(y - top),
  });
  const end = nodes.find(({ id }) => id === END_NODE);
  return {
    stages: new Map(nodes.filter(({ id }) => id !== END_NODE).map((node) => [node.id, at(node)])),
    end: end && at(end),
  };
}

/** The Pipeline laid out by `elk`. */
export async function autoAligned(
  stages: readonly Stage[],
  sizeOf: (stage: Stage) => FlowCardSize,
  elk: ElkLayout,
): Promise<FlowPositions> {
  return alignedPositions(await elk.layout(alignGraph(stages, sizeOf)));
}

/** A route row's middle, from a listing card's top, where none was measured: under its head. */
const ROW_TOP = 60;
const ROW_HEIGHT = 22;

/**
 * A card's size where none was measured at 100% (under 60%, a card shows only its name): its
 * estimated height and, when it lists its routes, its rows under its head.
 */
export function estimatedCardSize(stage: Stage, lists: boolean): FlowCardSize {
  return {
    width: CARD_WIDTH,
    height: estimatedCardHeight(stage),
    rowCentres: lists
      ? (stage.routes ?? []).map((_, row) => ROW_TOP + ROW_HEIGHT * row + ROW_HEIGHT / 2)
      : [],
  };
}
