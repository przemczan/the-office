import { conflictOnlyStages } from "./conflict-handling.js";
import { asFlow, reachableFrom, type FlowStage } from "./flow.js";
import {
  agentChoiceOf,
  hasChoiceTest,
  isFailureRoute,
  ROUTE_LIMIT_MAX,
  testsOf,
  type ConditionTest,
  type Route,
  type StagePosition,
} from "./route.js";
import {
  isPublishResultTest,
  PUBLISH_RESULT_NAMES,
  PUBLISH_RESULTS,
  type PublishResult,
} from "./publish-result.js";
import {
  isPublishStage,
  PUBLISH_COMMAND,
  publishesByThePublishingMode,
  sameWorkerNamed,
  stageWorker,
  type AgentStage,
  type Stage,
} from "./stage.js";

/**
 * A named set of Stages that a Task's work follows: a flow (spec §2.3), its Stages joined by
 * routes, kept in the Pipeline's order.
 */
export interface Pipeline {
  readonly id: string;
  readonly name: string;
  /** When to choose it, in a sentence. */
  readonly description: string;
  readonly stages: readonly Stage[];
  /** Where End stands on the canvas; undefined, right of the right-most Stage. */
  readonly endPosition?: StagePosition;
}

/** Where on its Stage a problem is: the Stage, or one of its routes (and a test in it). */
export type StageProblemAt =
  | { readonly kind: "stage" }
  | {
      readonly kind: "route";
      readonly routeIndex: number;
      /** The test's indexes in the route's condition, `[0, 1]`. */
      readonly testPath?: readonly number[];
    };

/** A `problem` refuses a save; a `warning` is shown and saved. */
export type StageProblemLevel = "problem" | "warning";

/** Why Stages can't run, or what is warned about, on the Stage it concerns by its key when there is one. */
export interface StageProblem {
  readonly stageKey?: string;
  readonly at?: StageProblemAt;
  readonly level: StageProblemLevel;
  readonly text: string;
}

/** A problem of the Pipeline as a whole, on no Stage. */
export function pipelineProblem(text: string): StageProblem {
  return { level: "problem", text };
}

/** `problems` as warnings: what an editor shows but saves, such as a Role nobody fills. */
export function asWarnings(problems: readonly StageProblem[]): StageProblem[] {
  return problems.map((problem) => ({ ...problem, level: "warning" }));
}

/**
 * Every reason the Stages can't run, so an editor can flag them all at once; empty when they can.
 * Stages with no routes are weighed as converted (`asFlow`), a kept on-failure setting as its route
 * back; the rest in the Pipeline's order, which the Stage's number in the words and "earlier" refer
 * to. Rules that need other modules (who fills
 * a Role, and their Task limit) are checked where those are known.
 */
export function stageProblems(stages: readonly Stage[]): StageProblem[] {
  return flowChecks(stages).filter(({ level }) => level === "problem");
}

/** What an editor warns about in the Stages but saves: a Stage whose routes all carry a condition. */
export function stageWarnings(stages: readonly Stage[]): StageProblem[] {
  return flowChecks(stages).filter(({ level }) => level === "warning");
}

function flowChecks(stages: readonly Stage[]): StageProblem[] {
  const ordered = asFlow(stages);
  const [first] = ordered;
  if (!first) return [pipelineProblem("A Pipeline needs at least one Stage.")];
  const reachable = reachableFrom(ordered, first.key);
  const reachingEnd = stagesReachingEnd(ordered);
  const loops = loopsWithNoLimit(ordered);
  const conflictOnly = conflictOnlyStages(ordered);
  return ordered.flatMap((stage, stageIndex) => {
    const located = (problem: LocatedProblem) =>
      problemOnStage(stage, stageIndex, problem.text, problem.at, problem.level);
    const earlierStages = ordered.slice(0, stageIndex);
    return [
      ...problemsOfStage(stage, earlierStages, stageBefore(stage, earlierStages, conflictOnly)).map(
        (text) => located({ text }),
      ),
      ...(reachable.has(stage.key)
        ? []
        : [located({ text: "no path of routes leads to it from the first Stage." })]),
      // A Stage with no route out is told to give it one instead.
      ...(reachingEnd.has(stage.key) || stage.routes.length === 0
        ? []
        : [located({ text: "no path of routes leads from it to End." })]),
      ...flowProblems(stage, ordered).map(located),
      ...loops.filter(({ from }) => from === stage.key).map((loop) => located(loopProblem(loop))),
    ];
  });
}

interface LocatedProblem {
  readonly text: string;
  readonly at?: StageProblemAt;
  readonly level?: StageProblemLevel;
}

/** A problem with one Stage, worded so the editor's banner says which Stage it means. */
export function problemOnStage(
  stage: Stage,
  stageIndex: number,
  problem: string,
  at: StageProblemAt = { kind: "stage" },
  level: StageProblemLevel = "problem",
): StageProblem {
  return {
    stageKey: stage.key,
    at,
    level,
    text: `Stage ${stageIndex + 1} · ${stage.name.trim() || stage.key}: ${problem}`,
  };
}

/**
 * What makes one Stage unable to run whatever Stages are around it: a name, and its kind's own
 * fields. A Stage template is checked with these alone; a Pipeline adds the rules about neighbours.
 */
export function singleStageProblems(stage: Stage): string[] {
  return [...nameProblems(stage, []), ...kindProblems(stage)];
}

function problemsOfStage(
  stage: Stage,
  earlierStages: readonly Stage[],
  before: Stage | undefined,
): string[] {
  const problems = [
    ...keyProblems(stage, earlierStages),
    ...nameProblems(stage, earlierStages),
    ...kindProblems(stage),
  ];
  if (stage.kind === "agent") problems.push(...continueProblems(stage, before));
  return problems;
}

function keyProblems(stage: Stage, earlierStages: readonly Stage[]): string[] {
  return earlierStages.some((earlier) => earlier.key === stage.key)
    ? [`another Stage has the key "${stage.key}".`]
    : [];
}

function nameProblems(stage: Stage, earlierStages: readonly Stage[]): string[] {
  if (stage.name.trim() === "") return ["give it a name."];
  return earlierStages.some((earlier) => earlier.name === stage.name)
    ? [`another Stage is named "${stage.name}".`]
    : [];
}

function kindProblems(stage: Stage): string[] {
  const problems: string[] = [];
  if (stage.kind === "agent") {
    problems.push(...workerProblems(stage));
    if (!isPositiveWholeNumber(stage.budget)) {
      problems.push("its budget must be a whole number of tokens above 0.");
    }
  }
  if (stage.kind === "script" && RESERVED_COMMAND_KEYS.has(stage.command)) {
    problems.push(`runs "${stage.command}", which is kept for The Office's own use.`);
  }
  // Neither field is on another kind's type, but a Stage given by an agent or kept may carry it.
  if (stage.kind !== "publish" && "publishTarget" in stage && stage.publishTarget !== undefined) {
    problems.push("only a Publish Stage has a publish target.");
  }
  if (stage.kind !== "agent" && "mergeBaseFirst" in stage && stage.mergeBaseFirst === true) {
    problems.push("only an Agent Stage merges the base first.");
  }
  return problems;
}

/** The keys no Project command, Script Stage or condition names (spec §2.1). */
const RESERVED_COMMAND_KEYS: ReadonlySet<string> = new Set(["install", PUBLISH_COMMAND]);

function workerProblems(stage: AgentStage): string[] {
  const namesRole = stage.role !== undefined && stage.role.trim() !== "";
  if (namesRole && stage.duty !== undefined) return ["name a Role or a duty, not both."];
  return stageWorker(stage) ? [] : ["choose who works it."];
}

/**
 * The Stage before `stage` in the Pipeline's order, whose session "continue" goes on. The conflict
 * chain's Stages (`conflictOnlyStages`), drawn in a row under their Publish, run only after a
 * conflict, so they are never on a path into a Stage outside the chain (spec §2.3.5, "Library")
 * and are passed over.
 */
function stageBefore(
  stage: Stage,
  earlierStages: readonly Stage[],
  conflictOnly: ReadonlySet<string>,
): Stage | undefined {
  if (conflictOnly.has(stage.key)) return earlierStages.at(-1);
  return earlierStages.findLast(({ key }) => !conflictOnly.has(key));
}

function continueProblems(stage: AgentStage, previous: Stage | undefined): string[] {
  return stage.session === "continue" &&
    (previous?.kind !== "agent" || !sameWorkerNamed(previous, stage))
    ? ["continuing a session needs the same Role or the same duty in the Stage before."]
    : [];
}

/** The flow's rules on one Stage (spec §2.3, "Validation"), `ordered` in the Pipeline's order. */
function flowProblems(stage: FlowStage, ordered: readonly FlowStage[]): LocatedProblem[] {
  const problems: LocatedProblem[] = [];
  if (stage.routes.length === 0) {
    problems.push({ text: "give it a route out; a final Stage's leads to End." });
  } else if (stage.routes.every(({ condition }) => condition !== null)) {
    problems.push({
      text: "every route out of it carries a condition, so when none holds the walk stops and asks.",
      level: "warning",
    });
  }
  if (publishesByThePublishingMode(stage) && routesTaking(stage, "conflict").length === 0) {
    problems.push({ text: "no route takes Conflict, so a conflict asks you.", level: "warning" });
  }
  stage.routes.forEach((route, routeIndex) => {
    const at: StageProblemAt = { kind: "route", routeIndex };
    for (const text of routeProblems(stage, route, routeIndex, ordered))
      problems.push({ text, at });
    for (const text of publishResultProblems(stage, route, routeIndex, ordered)) {
      problems.push({ text, at });
    }
    for (const { testPath, text } of conditionProblems(stage, route, ordered)) {
      problems.push({ text, at: { ...at, testPath } });
    }
  });
  return problems;
}

function routeProblems(
  stage: FlowStage,
  route: Route,
  routeIndex: number,
  ordered: readonly FlowStage[],
): string[] {
  const problems: string[] = [];
  const earlierRoutes = stage.routes.slice(0, routeIndex);
  const routeWords = `its route to ${placeName(route.to, route.toName, ordered)}`;
  if (route.to !== null && !ordered.some(({ key }) => key === route.to)) {
    problems.push(`${routeWords} leads to a Stage the Pipeline doesn't have.`);
  }
  if (!isRouteLimit(route.limit)) {
    problems.push(
      `${routeWords} has a limit of ${String(route.limit)}; give it 1 to ${ROUTE_LIMIT_MAX} times, or No limit.`,
    );
  }
  if (earlierRoutes.some(({ condition }) => condition === null)) {
    problems.push(`${routeWords} comes after one with no condition, so it is never followed.`);
  }
  // A failure route may lead where another route does: the Stage goes there whether it failed or not.
  const failure = isFailureRoute(route, stage.key);
  if (
    earlierRoutes.some(
      (earlier) => earlier.to === route.to && isFailureRoute(earlier, stage.key) === failure,
    )
  ) {
    problems.push(
      `${routeWords} leads where an earlier route does; join their conditions with Any of in one route.`,
    );
  }
  return [...problems, ...choiceRouteProblems(route, earlierRoutes, routeWords)];
}

/**
 * An Agent's choice is the only test of its route, and no two choice rows of a Stage share their
 * words, trimmed and whatever the case (spec §2.3, "Validation"); the test's own rules are
 * `testProblems`'.
 */
function choiceRouteProblems(
  route: Route,
  earlierRoutes: readonly Route[],
  routeWords: string,
): string[] {
  if (!route.condition || !hasChoiceTest(route.condition)) return [];
  const words = agentChoiceOf(route);
  if (words === undefined) {
    return [
      `${routeWords} mixes the Agent's choice with other tests; a choice is the only test of its route.`,
    ];
  }
  const same = choiceWordsKey(words);
  if (same === "") return [];
  const repeated = earlierRoutes.some((earlier) => {
    const earlierWords = agentChoiceOf(earlier);
    return earlierWords !== undefined && choiceWordsKey(earlierWords) === same;
  });
  return repeated
    ? [`${routeWords} has the same words as an earlier choice; give each choice its own words.`]
    : [];
}

function choiceWordsKey(words: string): string {
  return words.trim().toLowerCase();
}

/**
 * A Publish Stage's result leads to one place at most (spec §2.3.2, "The route forms"): the route
 * at `routeIndex` may not take a result an earlier route takes elsewhere.
 */
function publishResultProblems(
  stage: FlowStage,
  route: Route,
  routeIndex: number,
  ordered: readonly FlowStage[],
): string[] {
  if (!isPublishStage(stage)) return [];
  const earlierRoutes = stage.routes.slice(0, routeIndex);
  return PUBLISH_RESULTS.filter(
    (result) =>
      takesResult(stage, route, result) &&
      earlierRoutes.some(
        (earlier) => earlier.to !== route.to && takesResult(stage, earlier, result),
      ),
  ).map(
    (result) =>
      `its route to ${placeName(route.to, route.toName, ordered)} takes ${PUBLISH_RESULT_NAMES[result]}, which an earlier route takes elsewhere; a result leads to one place.`,
  );
}

/** The routes of `stage` that take `result`, testing it on their own Stage. */
function routesTaking(stage: FlowStage, result: PublishResult): Route[] {
  return stage.routes.filter((route) => takesResult(stage, route, result));
}

function takesResult(stage: FlowStage, { condition }: Route, result: PublishResult): boolean {
  if (!condition) return false;
  return testsOf(condition).some(
    ({ test }) =>
      test.kind === "stage" &&
      (test.stage === null || test.stage === stage.key) &&
      test.is === result,
  );
}

/** "At most N times", N from 1 to `ROUTE_LIMIT_MAX`, or No limit. */
function isRouteLimit(limit: Route["limit"]): boolean {
  return limit === null || (Number.isInteger(limit) && limit >= 1 && limit <= ROUTE_LIMIT_MAX);
}

function conditionProblems(
  stage: FlowStage,
  route: Route,
  ordered: readonly FlowStage[],
): { readonly testPath: readonly number[]; readonly text: string }[] {
  if (!route.condition) return [];
  const routeWords = `a condition of its route to ${placeName(route.to, route.toName, ordered)}`;
  return testsOf(route.condition).flatMap(({ test, testPath }) =>
    testProblems(test, stage, ordered).map((problem) => ({
      testPath,
      text: `${routeWords} ${problem}`,
    })),
  );
}

function testProblems(
  test: ConditionTest,
  stage: FlowStage,
  ordered: readonly FlowStage[],
): string[] {
  if (test.kind === "command") return commandTestProblems(test.key);
  if (test.kind === "choice") return choiceTestProblems(test.words, stage);
  if (test.kind !== "stage") return [];
  const problems: string[] = [];
  // Any Stage of the Pipeline may be tested, before or after the route's own: its latest run.
  if (test.stage !== null && !ordered.some(({ key }) => key === test.stage)) {
    problems.push(
      `tests ${placeName(test.stage, test.stageName, ordered)}, a Stage the Pipeline doesn't have.`,
    );
  }
  const testsItsOwnStage = test.stage === null || test.stage === stage.key;
  const tested = testsItsOwnStage ? stage : ordered.find(({ key }) => key === test.stage);
  if (tested && !isPublishStage(tested) && isPublishResultTest(test.is)) {
    problems.push(
      `tests whether ${tested.name.trim() || tested.key} ended ${PUBLISH_RESULT_NAMES[test.is]}, which only a Publish Stage ends.`,
    );
  }
  if (stage.kind === "gate" && testsItsOwnStage && test.is === "failed") {
    problems.push("tests whether this Gate failed, and a Gate never fails.");
  }
  if (test.is === "ran" && !isPositiveWholeNumber(test.times)) {
    problems.push("needs how many times the Stage ran, 1 or more.");
  }
  return problems;
}

/** An Agent's choice is an Agent Stage's alone, and the Agent chooses it by its words. */
function choiceTestProblems(words: string, stage: FlowStage): string[] {
  const problems: string[] = [];
  if (stage.kind !== "agent") {
    problems.push("is the Agent's choice, which only an Agent Stage has.");
  }
  if (words.trim() === "")
    problems.push("is a choice with no words; say when the Agent chooses it.");
  return problems;
}

/** A command test's key follows the Project command key rules (spec §2.1), and is never install or publish. */
function commandTestProblems(key: string): string[] {
  if (RESERVED_COMMAND_KEYS.has(key)) {
    return [`runs "${key}", which is kept for The Office's own use.`];
  }
  return COMMAND_KEY.test(key) && key.length <= COMMAND_KEY_LENGTH
    ? []
    : [
        `runs "${key}", which isn't a command's key: lower-case letters, digits and "-", starting with a letter, at most ${COMMAND_KEY_LENGTH} characters.`,
      ];
}

const COMMAND_KEY = /^[a-z][a-z0-9-]*$/;
const COMMAND_KEY_LENGTH = 40;

/** A Stage by its name in `ordered`, else the name kept beside its key, else its key; End for null. */
function placeName(
  key: string | null,
  keptName: string | undefined,
  ordered: readonly FlowStage[],
): string {
  if (key === null) return "End";
  const stage = ordered.find((other) => other.key === key);
  return stage?.name.trim() || keptName || key;
}

function isPositiveWholeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/**
 * The keys of the Stages a path of routes leads from to End, whatever their conditions (spec §2.3,
 * "End can be reached").
 */
function stagesReachingEnd(ordered: readonly FlowStage[]): ReadonlySet<string> {
  const keys = new Set(ordered.map(({ key }) => key));
  // A route to a Stage the Pipeline doesn't have is refused on its own, so it counts as reaching.
  const reaching = new Set(
    ordered
      .filter(({ routes }) => routes.some(({ to }) => to === null || !keys.has(to)))
      .map(({ key }) => key),
  );
  for (let grown = true; grown;) {
    grown = false;
    for (const { key, routes } of ordered) {
      if (!reaching.has(key) && routes.some(({ to }) => to !== null && reaching.has(to))) {
        reaching.add(key);
        grown = true;
      }
    }
  }
  return reaching;
}

/**
 * A loop of routes with No limit (spec §2.3, "Every loop has a limit"): its Stages' keys in the
 * order the walk could go round, from the Stage whose route starts it back to that Stage, and that
 * route's index among the Stage's routes.
 */
interface LoopWithNoLimit {
  readonly from: string;
  readonly routeIndex: number;
  readonly path: readonly string[];
  readonly names: readonly string[];
}

/**
 * One loop of No-limit routes per set of Stages they join into loops, so the walk could go round
 * it for ever; empty when every loop passes through a route with a limit. A set is a strongly
 * connected component of the No-limit routes; the loop named is the shortest round from its last
 * Stage in the Pipeline's order, so it starts with the route that leads back, the one to limit.
 */
function loopsWithNoLimit(ordered: readonly FlowStage[]): LoopWithNoLimit[] {
  const unlimited = new Map(
    ordered.map(({ key, routes }) => [
      key,
      routes.flatMap(({ to, limit }, routeIndex) =>
        limit === null && to !== null ? [{ to, routeIndex }] : [],
      ),
    ]),
  );
  const names = new Map(ordered.map(({ key, name }) => [key, name.trim() || key]));
  return stronglyConnected(
    ordered.map(({ key }) => key),
    (key) => (unlimited.get(key) ?? []).map(({ to }) => to),
  ).flatMap((component) => {
    const last = ordered.findLast(({ key }) => component.has(key));
    if (!last) return [];
    const round = shortestRound(last.key, component, unlimited);
    return round ? [{ ...round, names: round.path.map((key) => names.get(key) ?? key) }] : [];
  });
}

function loopProblem({ routeIndex, names }: LoopWithNoLimit): LocatedProblem {
  return {
    text: `the loop ${names.join(" → ")} has no route with a limit, so it could run for ever.`,
    at: { kind: "route", routeIndex },
  };
}

/**
 * The shortest way round from `start` back to it through `component`'s No-limit routes, by a search
 * breadth first; none when `start` has no route into the component (a lone Stage without a route to
 * itself).
 */
function shortestRound(
  start: string,
  component: ReadonlySet<string>,
  unlimited: ReadonlyMap<string, readonly { readonly to: string; readonly routeIndex: number }[]>,
): Omit<LoopWithNoLimit, "names"> | undefined {
  const cameFrom = new Map<string, string>();
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index] as string;
    for (const { to } of unlimited.get(key) ?? []) {
      if (!component.has(to)) continue;
      if (to === start) {
        const path = [start];
        for (let at: string | undefined = key; at !== start && at !== undefined;) {
          path.splice(1, 0, at);
          at = cameFrom.get(at);
        }
        path.push(start);
        const second = path[1];
        const routeIndex = unlimited
          .get(start)
          ?.find(({ to: next }) => next === second)?.routeIndex;
        return routeIndex === undefined ? undefined : { from: start, routeIndex, path };
      }
      if (!cameFrom.has(to)) {
        cameFrom.set(to, key);
        queue.push(to);
      }
    }
  }
  return undefined;
}

/**
 * The sets of `keys` that routes join into loops (Tarjan's strongly connected components), each
 * with more than one Stage, or one Stage with a route to itself.
 */
function stronglyConnected(
  keys: readonly string[],
  next: (key: string) => readonly string[],
): ReadonlySet<string>[] {
  const indexes = new Map<string, number>();
  const lowest = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: ReadonlySet<string>[] = [];
  const known = new Set(keys);
  const visit = (key: string) => {
    indexes.set(key, indexes.size);
    lowest.set(key, indexes.get(key) as number);
    stack.push(key);
    onStack.add(key);
    for (const to of next(key)) {
      if (!known.has(to)) continue;
      if (!indexes.has(to)) {
        visit(to);
        lowest.set(key, Math.min(lowest.get(key) as number, lowest.get(to) as number));
      } else if (onStack.has(to)) {
        lowest.set(key, Math.min(lowest.get(key) as number, indexes.get(to) as number));
      }
    }
    if (lowest.get(key) !== indexes.get(key)) return;
    const component = new Set<string>();
    for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
      onStack.delete(member);
      component.add(member);
      if (member === key) break;
    }
    if (component.size > 1 || next(key).includes(key)) components.push(component);
  };
  for (const key of keys) if (!indexes.has(key)) visit(key);
  return components;
}
