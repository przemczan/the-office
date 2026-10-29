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
 * The Stages as the walk goes over them: once a Publish run's conflict went to Resolve, Resolve,
 * the Project's Test and a Gate stand before that Publish (spec §2.3), so the Stage rows show them.
 */
export function walkedStages(stages: readonly Stage[], runs: readonly StageRun[]): Stage[] {
  const conflicted = runs.find(goesToResolve);
  if (!conflicted) return [...stages];
  return withResolveStages(
    stages,
    stages.findIndex(({ key }) => key === conflicted.stageKey),
  );
}

/** `stages` with the Resolve Stages before the Publish at `publishIndex`, unless they stand already. */
export function withResolveStages(stages: readonly Stage[], publishIndex: number): Stage[] {
  if (publishIndex < 0 || stages.some(isResolveStage)) return [...stages];
  return stages.toSpliced(publishIndex, 0, ...resolveStages(stages));
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
export function resolveBrief(baseBranch: string, conflictedFiles: readonly string[]): string {
  const files = conflictedFiles.map((file) => `- ${file}`).join("\n");
  return [
    `The Task's branch conflicts with ${baseBranch} as it now is, which other work moved on. The Office merged ${baseBranch} into the branch and left the conflicts in these files:`,
    files,
    "Edit each so it keeps what both sides meant, and remove every conflict marker (the <<<<<<<, ======= and >>>>>>> lines). Read the Task's Plan and what the base changed to judge it. Don't run git: The Office commits the merge once no marker is left, then runs the Project's Test.",
    "If you can't resolve a conflict, end the Stage failed and say why: the user is asked.",
  ].join("\n\n");
}

function resolveStages(stages: readonly Stage[]): readonly Stage[] {
  const agentStages = stages.filter((stage): stage is AgentStage => stage.kind === "agent");
  const person = agentStages[0];
  if (!person) return [];
  const resolve: AgentStage = {
    kind: "agent",
    key: RESOLVE_KEY,
    name: "Resolve",
    optional: false,
    role: person.role,
    brief: "",
    session: "fresh",
    budget: Math.max(...agentStages.map(({ budget }) => budget)) + RESOLVE_BUDGET,
  };
  const test: ScriptStage = {
    kind: "script",
    key: RESOLVE_TEST_KEY,
    name: "Test after Resolve",
    optional: false,
    command: "test",
    onFailure: { goBackTo: RESOLVE_KEY, rounds: RESOLVE_TEST_ROUNDS },
  };
  const gate: Gate = {
    kind: "gate",
    key: RESOLVE_GATE_KEY,
    name: "Review the resolved conflict",
    optional: false,
  };
  return [resolve, test, gate];
}
