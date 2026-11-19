import { promptTemplate, type PromptTexts } from "../../prompt-templates/index.js";
import { asFlow, type FlowStage } from "./flow.js";
import { plainRoute } from "./route.js";
import type { AgentStage, Gate, ScriptStage, Stage } from "./stage.js";
import type { CarriedFailure, StageRun } from "./stage-run.js";

/**
 * The keys of the Stages The Office puts before a Publish whose branch conflicts with the base
 * (spec §2.3, "Conflicts at Publish"). Their `office:` prefix is one no Stage the editor names
 * takes, so they never meet the Task's own keys.
 */
export const RESOLVE_KEY = "office:resolve";
export const RESOLVE_TEST_KEY = "office:resolve-test";
export const RESOLVE_GATE_KEY = "office:resolve-gate";
const RESOLVE_STAGE_KEYS: ReadonlySet<string> = new Set([
  RESOLVE_KEY,
  RESOLVE_TEST_KEY,
  RESOLVE_GATE_KEY,
]);

/**
 * How many times a conflict at Publish goes to Resolve: the third time it comes back after
 * Resolve, the user is asked instead.
 */
export const RESOLVE_ROUNDS = 3;

/** The Project command the Test after Resolve runs (spec §2.3). */
export const RESOLVE_TEST_COMMAND = "test";

/** How many times a failing Test after Resolve goes back to Resolve. */
const RESOLVE_TEST_ROUNDS = 2;

/**
 * The tokens Resolve may use beyond the Task's other Agent Stages, whose budgets count the whole
 * Task's tokens (spec §2.3).
 */
const RESOLVE_BUDGET = 250_000;

/** Whether The Office put the Stage in for a conflict at Publish, rather than the Task's own. */
export function isResolveStage(stage: Pick<Stage, "key">): boolean {
  return RESOLVE_STAGE_KEYS.has(stage.key);
}

/** The Task's own Stages alone, as an edit keeps them: The Office puts its Resolve Stages back. */
export function withoutResolveStages(stages: readonly Stage[]): Stage[] {
  return stages.filter((stage) => !isResolveStage(stage));
}

/**
 * Whether the Publish run's conflict goes to Resolve: a run of a Publish asked about before The
 * Office resolved conflicts keeps that Decision, and goes as its answer says.
 */
export function goesToResolve(run: StageRun): boolean {
  return (
    run.outcome?.status === "failed" &&
    run.outcome.baseMoved !== undefined &&
    !run.decisions.some(({ kind }) => kind === "base-moved")
  );
}

/**
 * The Stages as the walk goes over them, as a flow (`asFlow`): once a Publish run's conflict went
 * to Resolve, Resolve and the Project's Test stand before that Publish, with a Gate after them when
 * the Publish asks for a review (spec §2.3), so the Stage rows show them.
 */
export function walkedStages<Of extends Stage>(
  stages: readonly Of[],
  runs: readonly StageRun[],
): FlowStage<Of | Stage>[] {
  const flow = asFlow(stages);
  const conflicted = runs.find(goesToResolve);
  if (!conflicted) return flow;
  return withResolveStages(
    flow,
    flow.findIndex(({ key }) => key === conflicted.stageKey),
  );
}

/**
 * `stages` with the Resolve Stages before the Publish at `publishIndex`, unless they stand already:
 * each at the Publish's place, with one route to the next and the last to the Publish.
 */
export function withResolveStages<Of extends Stage>(
  stages: readonly Of[],
  publishIndex: number,
): (Of | FlowStage)[] {
  const publish = stages[publishIndex];
  if (!publish || stages.some(isResolveStage)) return [...stages];
  const resolve = resolveStages(stages, publish);
  const chained = resolve.map((stage, index): FlowStage => ({
    ...stage,
    routes: [plainRoute(resolve[index + 1]?.key ?? publish.key)],
    place: publish.place ?? { column: publishIndex, row: 0 },
  }));
  return [...stages.slice(0, publishIndex), ...chained, ...stages.slice(publishIndex)];
}

/**
 * The run's failure carried to Resolve when a Publish conflicted: which time the conflict came,
 * out of the times Resolve takes it.
 */
export function conflictCarried(
  publish: Stage,
  error: string,
  conflictsSoFar: number,
): CarriedFailure {
  return { stageKey: publish.key, error, round: conflictsSoFar, rounds: RESOLVE_ROUNDS };
}

/** Whether the conflict came back once too often, so Resolve leaves it to the user. */
export function conflictCameBackTooOften(carried: CarriedFailure | undefined): boolean {
  return (
    carried !== undefined &&
    !isResolveStage({ key: carried.stageKey }) &&
    carried.round > RESOLVE_ROUNDS
  );
}

/** Whether Resolve runs again after its Test failed, to fix what the merge left broken. */
export function afterResolveTestFailed(carried: CarriedFailure | undefined): boolean {
  return carried?.stageKey === RESOLVE_TEST_KEY;
}

/**
 * Whether the user said they resolved the conflict in the worktree, answering the Decision on the
 * Resolve run before this one: The Office then only commits the merge.
 */
export function resolvedByTheUser(earlierRuns: readonly StageRun[]): boolean {
  const last = earlierRuns.at(-1);
  return (
    last?.stageKey === RESOLVE_KEY &&
    last.decisions.some(
      ({ kind, answer }) => kind === "base-moved" && answer?.kind === "resolved-in-worktree",
    )
  );
}

/** What Resolve's Agent is told: the conflicted files to edit, and to leave git to The Office. */
export const RESOLVE_BRIEF = promptTemplate({
  key: "pipelines.resolve-brief",
  domain: "pipelines",
  name: "Resolve's Brief",
  description:
    "What the Agent of a Resolve Stage is told when the Task's branch conflicts with its base branch at Publish.",
  variables: {
    baseBranch: { kind: "text", description: "The branch the Task publishes onto, such as main." },
    conflictedFiles: {
      kind: "list",
      description: "The files the merge left conflicts in, each read as {{.}}.",
    },
  },
  text: `The Task's branch conflicts with {{baseBranch}} as it now is, which other work moved on. The Office merged {{baseBranch}} into the branch and left the conflicts in these files:

{{#conflictedFiles}}
- {{.}}
{{/conflictedFiles}}

Edit each so it keeps what both sides meant, and remove every conflict marker (the <<<<<<<, ======= and >>>>>>> lines). Read the Task's Plan and what the base changed to judge it. Don't run git: The Office commits the merge once no marker is left, then runs the Project's Test.

If you can't resolve a conflict, end the Stage failed and say why: the user is asked.`,
});

/** What Resolve's Agent is told when the Project's Test failed after the merge was committed. */
export const RESOLVE_AFTER_TEST = promptTemplate({
  key: "pipelines.resolve-after-test",
  domain: "pipelines",
  name: "Resolve's Brief after a failed Test",
  description:
    "What the Agent of a Resolve Stage is told when the Project's Test failed after The Office merged the base branch into the Task's branch.",
  variables: {},
  text: "The Project's Test failed after The Office merged the base branch into the Task's branch. Fix what the merge left broken, as the failure below shows, keeping what both sides meant. Don't run git: The Office commits your changes.",
});

/** What Resolve's Agent is told when the user sent the resolved conflict back from the Gate. */
export const RESOLVE_AFTER_GATE = promptTemplate({
  key: "pipelines.resolve-after-gate",
  domain: "pipelines",
  name: "Resolve's Brief after the user sent it back",
  description:
    "What the Agent of a Resolve Stage is told when the user reviewed how the conflict was resolved and sent it back with feedback.",
  variables: {},
  text: "The user reviewed how the conflict with the base branch was resolved and sent it back. The merge is committed already: change what their feedback below asks, keeping what both sides meant. Don't run git: The Office commits your changes.",
});

/** Resolve's Brief, as the user's text of `RESOLVE_BRIEF` words it. */
export function resolveBrief(
  prompts: PromptTexts,
  baseBranch: string,
  conflictedFiles: readonly string[],
): string {
  return prompts.render(RESOLVE_BRIEF, { baseBranch, conflictedFiles });
}

function resolveStages(stages: readonly Stage[], publish: Stage): readonly Stage[] {
  const agentStages = stages.filter((stage): stage is AgentStage => stage.kind === "agent");
  const person = agentStages[0];
  if (!person) return [];
  const resolve: AgentStage = {
    kind: "agent",
    key: RESOLVE_KEY,
    name: "Resolve",
    optional: false,
    // Whoever works the first Agent Stage: its Role, or its duty, or both once the walk staffed it.
    ...(person.role === undefined ? {} : { role: person.role }),
    ...(person.duty === undefined ? {} : { duty: person.duty }),
    brief: "",
    session: "fresh",
    budget: Math.max(...agentStages.map(({ budget }) => budget)) + RESOLVE_BUDGET,
  };
  const test: ScriptStage = {
    kind: "script",
    key: RESOLVE_TEST_KEY,
    name: "Test after Resolve",
    optional: false,
    command: RESOLVE_TEST_COMMAND,
    onFailure: { goBackTo: RESOLVE_KEY, rounds: RESOLVE_TEST_ROUNDS },
  };
  const gate: Gate = {
    kind: "gate",
    key: RESOLVE_GATE_KEY,
    name: "Review the resolved conflict",
    optional: false,
  };
  const reviewed = publish.kind === "script" && publish.afterConflict === "review";
  return reviewed ? [resolve, test, gate] : [resolve, test];
}
