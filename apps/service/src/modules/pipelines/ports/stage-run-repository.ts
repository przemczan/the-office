import type { StageCommandRunWithOutput } from "../domain/stage-command-run.js";
import type {
  EngineSwitch,
  GateAction,
  ChosenRoute,
  PublishedWork,
  StageRun,
  StageRunContext,
  StageRunDecision,
  StageRunStandIn,
  StageSessionMove,
  StageTokens,
  AskedInterruption,
  HoldingUser,
  StartedOver,
  TaskRestart,
} from "../domain/stage-run.js";
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

/** Where each Task's Stage runs are kept. */
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

  /** Saves the Decisions the walk opened on the run, replacing those saved before. */
  abstract saveDecisions(runId: string, decisions: readonly StageRunDecision[]): Promise<void>;

  /** Saves what a Publish run shipped, before its after publishing line runs. */
  abstract savePublished(runId: string, published: PublishedWork): Promise<void>;

  /** Saves the route the run's Agent chose, replacing the one it chose before. */
  abstract saveRouteChoice(runId: string, choice: ChosenRoute): Promise<void>;

  /** Since when the running run waits for a free run environment; undefined once it doesn't. */
  abstract saveWaitingSince(runId: string, waitingSince: Date | undefined): Promise<void>;

  /**
   * Saves what the user, or the fire alarm, asked of the run while it runs, with the user who
   * asked, replacing what was asked before.
   */
  abstract saveHeldBy(
    runId: string,
    heldBy: AskedInterruption,
    heldByUser: HoldingUser | undefined,
  ): Promise<void>;

  /**
   * Saves the user's Restart from… on the Task's ended held run; false when the run has one already
   * or hasn't ended, as each held run takes one.
   */
  abstract saveRestart(runId: string, restart: TaskRestart): Promise<boolean>;

  /**
   * Saves the Start over on the last run before it; false when that run has one already.
   */
  abstract saveStartedOver(runId: string, startedOver: StartedOver): Promise<boolean>;

  /**
   * Saves what the user did at a Gate's run; false when an action was saved first, as each Gate
   * run takes one.
   */
  abstract saveGateAction(runId: string, gateAction: GateAction): Promise<boolean>;

  /**
   * Saves how the run ended, with what it was held by unless what was asked of it is saved
   * already; a run that saved no changed files, such as a Gate's, changed none.
   */
  abstract saveEnded(run: StageRun): Promise<void>;

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
