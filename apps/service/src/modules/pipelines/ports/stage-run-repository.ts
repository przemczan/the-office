import type { StageCommandRunWithOutput } from "../domain/stage-command-run.js";
import type {
  GateAction,
  PublishedWork,
  StageRun,
  StageRunContext,
  StageRunDecision,
  StageSessionMove,
  StageTokens,
  AskedInterruption,
  HoldingUser,
} from "../domain/stage-run.js";

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
}

/** Where each Task's Stage runs are kept. */
export abstract class StageRunRepository {
  /**
   * Saves a run that has just started; false when the Task already has a run of that number, so two
   * walks of one Task can't both go on.
   */
  abstract saveNew(run: StageRun): Promise<boolean>;

  abstract saveThread(runId: string, thread: StageRunThread): Promise<void>;

  /** Saves the commit The Office left the Task's branch at after the run. */
  abstract saveHeadCommit(runId: string, headCommit: string): Promise<void>;

  /** Saves the Project commands The Office ran for the run, replacing those saved before. */
  abstract saveCommandRuns(
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
   * Saves what the user did at a Gate's run; false when an action was saved first, as each Gate
   * run takes one.
   */
  abstract saveGateAction(runId: string, gateAction: GateAction): Promise<boolean>;

  /** Saves how the run ended. */
  abstract saveEnded(run: StageRun): Promise<void>;

  /** The Task's runs, oldest first, without their commands' whole outputs. */
  abstract list(taskId: string): Promise<readonly StageRun[]>;

  /** The runs of each of the Tasks, each Task's oldest first, as `list` gives them. */
  abstract listOfTasks(taskIds: readonly string[]): Promise<readonly StageRun[]>;

  /**
   * What each command of the Task's run printed, in the order of its command runs; a run saved
   * before whole outputs were kept gives the filtered output it has. Undefined for no such run.
   */
  abstract commandOutputs(taskId: string, runId: string): Promise<readonly string[] | undefined>;
}
