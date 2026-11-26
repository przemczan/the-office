import type { ProposedRoutes, Route, Stage } from "@the-office/contracts";
import { atMostWords, routeTargetName, routeWhen, type RouteSource } from "./condition-words.ts";
import type { FlowOverlay } from "./flow-marks.ts";

/** One Stage whose routes a Proposal changes: as they were (none for a new Stage) and as proposed. */
export type ProposedStageRoutes = ProposedRoutes["stages"][number];

/** A Proposal on the canvas: its Stages with the routes it keeps, and the rest drawn over them. */
export interface ProposalFlow {
  readonly stages: readonly Stage[];
  readonly overlay: FlowOverlay;
}

/**
 * The flow a Proposal shows before it is applied (docs/design/pipeline-flow.html):
 * `stages` as proposed, each changed Stage keeping only the routes it had already, so the canvas
 * draws those as they are; the routes it adds are proposed, dashed, and those it takes away dotted.
 * A removed Stage isn't on the flow, so neither are its routes.
 */
export function proposalFlow(stages: readonly Stage[], routes: ProposedRoutes): ProposalFlow {
  const changed = new Map(routes.stages.map((change) => [change.stageKey, change]));
  const proposed = new Map<string, readonly Route[]>();
  const takenAway = new Map<string, readonly Route[]>();
  const shown = stages.map((stage) => {
    const change = changed.get(stage.key);
    if (!change) return stage;
    const kept = change.to.filter((route) => isAmong(route, change.from));
    proposed.set(
      stage.key,
      change.to.filter((route) => !isAmong(route, kept)),
    );
    takenAway.set(
      stage.key,
      change.from.filter((route) => !isAmong(route, kept)),
    );
    return { ...stage, routes: kept };
  });
  return { stages: shown, overlay: { proposed, takenAway } };
}

/**
 * The banner's words for what a Proposal does beyond routes (docs/design/pipeline-free-placement.html,
 * "The Proposal on the flow"): the Pipeline's order when it changes it, and how many Stages it moves
 * on the canvas, which doesn't change how the Pipeline runs. None when it does neither.
 */
export function layoutSentences(
  was: readonly Stage[],
  proposed: readonly Stage[],
): readonly string[] {
  const before = new Map(was.map((stage) => [stage.key, stage]));
  const kept = proposed.filter(({ key }) => before.has(key)).map(({ key }) => key);
  const keptBefore = was.filter(({ key }) => kept.includes(key)).map(({ key }) => key);
  // An added Stage changes the order when it goes in among the Stages there already.
  const lastKept = proposed.findLastIndex(({ key }) => before.has(key));
  const addedAmong = proposed.some(({ key }, index) => !before.has(key) && index < lastKept);
  const reordered = addedAmong || kept.some((key, index) => keptBefore[index] !== key);
  const moved = proposed.filter(({ key, position }) => {
    const earlier = before.get(key)?.position;
    return earlier && position && (earlier.x !== position.x || earlier.y !== position.y);
  }).length;
  return [
    ...(reordered
      ? [`It changes the Pipeline's order to ${proposed.map(({ name }) => name).join(", ")}.`]
      : []),
    ...(moved > 0
      ? [
          `It also moves ${moved === 1 ? "1 Stage" : `${moved} Stages`} on the canvas, which doesn't change how the Pipeline runs.`,
        ]
      : []),
  ];
}

/** How a route reads after where it leads: "→ Review & fix, always", "→ Publish otherwise". */
export function routeWhenAfterTarget(
  route: Route,
  from: RouteSource,
  stages: readonly Stage[],
  index: number,
): string {
  const when = routeWhen(route, from, stages, index);
  return when === "always" ? `, ${when}` : ` ${when}`;
}

/**
 * The banner's sentence for one changed Stage, with each route's limit: "Routes out of Tests: to
 * Implement when Tests ended Failed, at most 3 times, to Review & fix when Implement changed files,
 * otherwise to Publish."
 */
export function routesOutSentence(change: ProposedStageRoutes, stages: readonly Stage[]): string {
  const from = sourceOf(change, "to");
  const parts = change.to.map((route, index) => {
    const target = `to ${routeTargetName(route, stages)}`;
    const when = routeWhen(route, from, stages, index);
    const said =
      when === "always" || when === "otherwise" ? `${when} ${target}` : `${target} ${when}`;
    return route.limit === null || route.limit === undefined
      ? said
      : `${said}, ${atMostWords(route.limit)}`;
  });
  const said = parts.length > 0 ? parts.join(", ") : "taken away with the Stage";
  return `Routes out of ${change.stageName}: ${said}.`;
}

/** The changed Stage as condition words need it, with its routes as they were or as proposed. */
export function sourceOf(change: ProposedStageRoutes, side: "from" | "to"): RouteSource {
  return { name: change.stageName, routes: [...change[side]] };
}

/**
 * What the check found when the Proposal was drafted, as the card's "Checked: …" line says it; a
 * problem refuses the draft, so only what it passed is said.
 */
export function checkedSentence(): string {
  return "Checked: every Stage is reached, each has a route out, End can be reached from each, and every loop has a route with a limit.";
}

function isAmong(route: Route, routes: readonly Route[]): boolean {
  return routes.some((each) => sameRoutes([each], [route]));
}

/** Two lists of routes alike, the names kept for their words alone left out. */
function sameRoutes(one: readonly Route[], other: readonly Route[]): boolean {
  return JSON.stringify(one, unnamedKeys) === JSON.stringify(other, unnamedKeys);
}

function unnamedKeys(key: string, value: unknown): unknown {
  if (key === "toName" || key === "stageName") return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value).toSorted(([one], [other]) => one.localeCompare(other)),
  );
}
