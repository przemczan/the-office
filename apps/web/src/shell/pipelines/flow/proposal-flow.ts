import type { ProposedRoutes, Route, Stage } from "@the-office/contracts";
import { routeTargetName, routeWhen, type RouteSource } from "./condition-words.ts";
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
 * The banner's sentence for one changed Stage: "Routes out of Tests: to Review & fix when
 * Implement changed files, otherwise to Publish."
 */
export function routesOutSentence(change: ProposedStageRoutes, stages: readonly Stage[]): string {
  const from = sourceOf(change, "to");
  const parts = change.to.map((route, index) => {
    const target = `to ${routeTargetName(route, stages)}`;
    const when = routeWhen(route, from, stages, index);
    return when === "always" || when === "otherwise" ? `${when} ${target}` : `${target} ${when}`;
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
 * problem refuses the draft, so only what it passed is said, then the On failure loops kept.
 */
export function checkedSentence(stages: readonly Stage[]): string {
  const passed =
    "Checked: every Stage is reached, each has a route out and every route leads forward.";
  const looping = stages.filter((stage) => stage.kind !== "gate" && stage.onFailure);
  const [only] = looping;
  if (only === undefined) return passed;
  if (looping.length === 1)
    return `${passed} ${only.name}'s On failure loop still has a path back.`;
  const names = looping.map(({ name }) => `${name}'s`);
  const joined = `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return `${passed} ${joined} On failure loops still have a path back.`;
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
