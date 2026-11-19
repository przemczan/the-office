import { asFlow, hasPath, pipelineOrder, reachableFrom, type FlowStage } from "./flow.js";
import { testsOf, type ConditionTest, type Route } from "./route.js";
import {
  PUBLISH_COMMAND,
  sameWorkerNamed,
  stageWorker,
  type AgentStage,
  type OnFailure,
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
}

/** Where on its Stage a problem is: the Stage, one of its routes (and a test in it), or On failure. */
export type StageProblemAt =
  | { readonly kind: "stage" }
  | {
      readonly kind: "route";
      readonly routeIndex: number;
      /** The test's indexes in the route's condition, `[0, 1]`. */
      readonly testPath?: readonly number[];
    }
  | { readonly kind: "onFailure" };

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
 * Stages with no routes are weighed as converted (`asFlow`); the rest in the Pipeline's order, which
 * the Stage's number in the words and "earlier" refer to. Rules that need other modules (who fills
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
  const ordered = pipelineOrder(asFlow(stages));
  const [first] = ordered;
  if (!first) return [pipelineProblem("A Pipeline needs at least one Stage.")];
  const reachable = reachableFrom(ordered, first.key);
  return ordered.flatMap((stage, stageIndex) => {
    const located = (problem: LocatedProblem) =>
      problemOnStage(stage, stageIndex, problem.text, problem.at, problem.level);
    return [
      ...problemsOfStage(stage, ordered.slice(0, stageIndex)).map((text) => located({ text })),
      ...(reachable.has(stage.key)
        ? []
        : [located({ text: "no path of routes leads to it from the first Stage." })]),
      ...flowProblems(stage, ordered).map(located),
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

function problemsOfStage(stage: Stage, earlierStages: readonly Stage[]): string[] {
  const problems = [
    ...keyProblems(stage, earlierStages),
    ...nameProblems(stage, earlierStages),
    ...kindProblems(stage),
  ];
  if (stage.kind === "agent") problems.push(...continueProblems(stage, earlierStages.at(-1)));
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
  if (stage.kind === "script" && stage.command !== "publish" && stage.publishTarget) {
    problems.push("only a Publish Stage has a publish target.");
  }
  if (stage.kind === "script" && stage.command !== "publish" && stage.afterConflict) {
    problems.push("only a Publish Stage says what follows a conflict.");
  }
  return problems;
}

function workerProblems(stage: AgentStage): string[] {
  const namesRole = stage.role !== undefined && stage.role.trim() !== "";
  if (namesRole && stage.duty !== undefined) return ["name a Role or a duty, not both."];
  return stageWorker(stage) ? [] : ["choose who works it."];
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
  stage.routes.forEach((route, routeIndex) => {
    const at: StageProblemAt = { kind: "route", routeIndex };
    for (const text of routeProblems(stage, route, routeIndex, ordered))
      problems.push({ text, at });
    for (const { testPath, text } of conditionProblems(stage, route, ordered)) {
      problems.push({ text, at: { ...at, testPath } });
    }
  });
  if (stage.kind !== "gate" && stage.onFailure) {
    for (const text of onFailureProblems(stage, stage.onFailure, ordered)) {
      problems.push({ text, at: { kind: "onFailure" } });
    }
  }
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
  if (route.to !== null) {
    const target = ordered.find(({ key }) => key === route.to);
    if (!target) problems.push(`${routeWords} leads to a Stage the Pipeline doesn't have.`);
    else if (target.place.column <= stage.place.column) {
      problems.push(
        `${routeWords} leads to its own or an earlier column; routes lead forward, and On failure is the way back.`,
      );
    }
  }
  if (earlierRoutes.some(({ condition }) => condition === null)) {
    problems.push(`${routeWords} comes after one with no condition, so it is never followed.`);
  }
  if (earlierRoutes.some(({ to }) => to === route.to)) {
    problems.push(
      `${routeWords} leads where an earlier route does; join their conditions with Any of in one route.`,
    );
  }
  return problems;
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
  if (test.kind !== "stage") return [];
  const problems: string[] = [];
  if (test.stage !== null) {
    const testedIndex = ordered.findIndex(({ key }) => key === test.stage);
    const testedName = placeName(test.stage, test.stageName, ordered);
    if (testedIndex === -1)
      problems.push(`tests ${testedName}, a Stage the Pipeline doesn't have.`);
    else if (testedIndex > ordered.indexOf(stage)) {
      problems.push(`tests ${testedName}, a later Stage; test this Stage or an earlier one.`);
    }
  }
  if (test.is === "ran" && !isPositiveWholeNumber(test.times)) {
    problems.push("needs how many times the Stage ran, 1 or more.");
  }
  return problems;
}

/** A command test's key follows the Project command key rules (spec §2.1), and is never install or publish. */
function commandTestProblems(key: string): string[] {
  if (key === "install" || key === PUBLISH_COMMAND) {
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

function onFailureProblems(
  stage: FlowStage,
  onFailure: OnFailure,
  ordered: readonly FlowStage[],
): string[] {
  const problems: string[] = [];
  const target = ordered.find((other) => other.key === onFailure.goBackTo);
  if (!target || target.place.column >= stage.place.column) {
    problems.push("on failure it can only go back to an earlier Stage.");
  } else if (target.kind === "gate") problems.push("on failure it can't go back to a Gate.");
  else if (!hasPath(ordered, target.key, stage.key)) {
    problems.push(
      `on failure it goes back to ${target.name.trim() || target.key}, but no path of routes leads from there back to it.`,
    );
  }
  if (!isPositiveWholeNumber(onFailure.rounds)) {
    problems.push("on failure it must go back a whole number of times, at least once.");
  }
  return problems;
}

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
