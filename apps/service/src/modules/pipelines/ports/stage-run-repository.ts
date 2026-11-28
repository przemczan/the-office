import type { StageCommandRunWithOutput } from "../domain/stage-command-run.js";
import type {
  EngineSwitch,
  ChosenRoute,
  PublishedWork,
  StageRun,
  StageRunContext,
  StageRunStandIn,
  StageSessionMove,
  StageTokens,
} from "../domain/stage-run.js";
import type { StageRunChange } from "../domain/stage-run-changes.js";
import type { StageRunUsage } from "../domain/usage-history.js";

/**
 * The Stage Thread a run works in, how its session began, and what the session runs on: the
 * engine's id and its name now, and the model.
 */
export interface StageRunThread {
  readonly threadId: string;
  readonly session: StageSessionMove;
  readonly engineId: string;
  readonly engineName: string;
  readonly model: string;
  /** The cascade's engine it stands in for; undefined when it runs on the cascade's own. */
  readonly standInFor: StageRunStandIn | undefined;
}

/** Where The Office left the Task's branch after a run, and what the run's own commit changed. */
export interface LeftBranch {
  readonly headCommit: string;
  readonly changedFiles: readonly string[];
}

/** A Stage run's tokens, and whether its Stage already had a run on the same Task before it. */
export interface StartedStageRun {
  readonly taskId: string;
  readonly tokens: StageTokens;
  /** True when an earlier run (a lower number) of the same Stage on the same Task exists. */
  readonly retry: boolean;
}

/** An Agent Stage run that ran at some time in a range, with what its session ran on. */
export interface RanAgentStageRun {
  readonly engineId: string;
  readonly taskId: string;
  /** Its Stage's name in the Task's Stages now; its key when the Task no longer has the Stage. */
  readonly stageName: string;
  readonly startedAt: Date;
  /** Undefined while it runs. */
  readonly endedAt: Date | undefined;
}

/**
 * The engines a Stage run's session ran on, by their names at the time: the one it ran on last, the
 * cascade's engine that one stood in for, and each switch of engine during the run. A name is
 * undefined where the run kept none.
 */
export interface KeptStageRunEngines {
  readonly taskId: string;
  readonly number: number;
  readonly engineId: string;
  readonly engineName: string | undefined;
  readonly standInFor:
    { readonly engineId: string; readonly engineName: string | undefined } | undefined;
  readonly switches: readonly EngineSwitch[];
}

/**
 * Where each Task's Stage runs are kept. What several hands change at once (what was asked of a
 * run, its Decisions and their answers, its end, a Gate's action, a Restart from…, a Start over)
 * goes through `update` and a change of `stage-run-changes.ts`; each other write sets fields only
 * the run's own Stage or the Task's walk writes, without reading them back first.
 */
export abstract class StageRunRepository {
  /**
   * Saves a run that has just started; false when the Task already has a run of that number, so two
   * walks of one Task can't both go on.
   */
  abstract saveNew(run: StageRun): Promise<boolean>;

  abstract saveThread(runId: string, thread: StageRunThread): Promise<void>;

  /**
   * Appends `engineSwitch` to the run's switches and saves the engine its session runs on now, with
   * the cascade's engine that one stands in for, together.
   */
  abstract saveEngineSwitch(
    runId: string,
    engineSwitch: EngineSwitch,
    now: Pick<StageRunThread, "engineId" | "engineName" | "standInFor">,
  ): Promise<void>;

  /** The Task the run `runId` is of; undefined when no run has that id. */
  abstract taskOf(runId: string): Promise<string | undefined>;

  /** Saves the commit HEAD moved to while the run runs, by a base update The Office made. */
  abstract saveHeadCommit(runId: string, headCommit: string): Promise<void>;

  /**
   * Saves where The Office left the Task's branch after the run, with the files its commit of the
   * run's work changed, together, so neither is ever kept without the other.
   */
  abstract saveLeftBranch(runId: string, left: LeftBranch): Promise<void>;

  /** Saves the Project commands The Office ran for the run, replacing those saved before. */
  abstract saveCommandRuns(
    runId: string,
    commandRuns: readonly StageCommandRunWithOutput[],
  ): Promise<void>;

  /**
   * Adds Project commands The Office ran for the run after those saved before, such as a condition
   * command's runs on the ended run its routes leave.
   */
  abstract addCommandRuns(
    runId: string,
    commandRuns: readonly StageCommandRunWithOutput[],
  ): Promise<void>;

  /** Saves the run's tokens so far, replacing those saved before. */
  abstract saveTokens(runId: string, tokens: StageTokens): Promise<void>;

  /** Saves the run's session's context after its latest turn, replacing what was saved before. */
  abstract saveContext(runId: string, context: StageRunContext): Promise<void>;

  /** Saves what a Publish run shipped, before its after publishing line runs. */
  abstract savePublished(runId: string, published: PublishedWork): Promise<void>;

  /** Saves the route the run's Agent chose, replacing the one it chose before. */
  abstract saveRouteChoice(runId: string, choice: ChosenRoute): Promise<void>;

  /** Since when the running run waits for a free run environment; undefined once it doesn't. */
  abstract saveWaitingSince(runId: string, waitingSince: Date | undefined): Promise<void>;

  /**
   * Applies `change` to the run as stored, holding the run until what it changed is saved, so two
   * changes at once never lose one: the second reads the run as the first left it. Answers the
   * change as saved, or undefined when it changes nothing. A run there is none of is a fault.
   */
  abstract update<Change extends StageRunChange | undefined>(
    runId: string,
    change: (run: StageRun) => Change,
  ): Promise<Change>;

  /** The Task's runs, oldest first, without their commands' whole outputs. */
  abstract list(taskId: string): Promise<readonly StageRun[]>;

  /** The runs of each of the Tasks, each Task's oldest first, as `list` gives them. */
  abstract listOfTasks(taskIds: readonly string[]): Promise<readonly StageRun[]>;

  /**
   * What the ended runs of the `limit` Tasks among `taskIds` whose last run ended latest used, each
   * Task's oldest first: only their usage, as a Usage estimate reads many Tasks' runs at once.
   */
  abstract latestTasksUsage(
    taskIds: readonly string[],
    limit: number,
  ): Promise<readonly StageRunUsage[]>;

  /**
   * What each command of the Task's run printed, in the order of its command runs; a run saved
   * before whole outputs were kept gives the filtered output it has. Undefined for no such run.
   */
  abstract commandOutputs(taskId: string, runId: string): Promise<readonly string[] | undefined>;

  /**
   * Every run started at or after `since`, of any Task; a retry counts even when its Stage's first
   * run started before `since`.
   */
  abstract startedSince(since: Date): Promise<readonly StartedStageRun[]>;

  /**
   * Every Agent Stage run, of any Task, that ran at some time between `from` and `to`: started
   * before `to`, and not ended or ended after `from`; oldest first. A run that kept no engine (one
   * kept before it was recorded, or one whose session never opened) is left out.
   */
  abstract ranBetween(from: Date, to: Date): Promise<readonly RanAgentStageRun[]>;

  /**
   * The engines each run of the Tasks ran on, each Task's oldest first; a run that kept no engine
   * (a Script Stage's, a Gate's, one whose session never opened) is left out.
   */
  abstract enginesOfTasks(taskIds: readonly string[]): Promise<readonly KeptStageRunEngines[]>;
}
