import type { StageCommandRun } from "../domain/stage-command-run.js";
import type { StageRun, StageRunDecision, StageTokens } from "../domain/stage-run.js";

/** Where each Task's Stage runs are kept. */
export abstract class StageRunRepository {
  /**
   * Saves a run that has just started; false when the Task already has a run of that number, so two
   * walks of one Task can't both go on.
   */
  abstract saveNew(run: StageRun): Promise<boolean>;

  /** Saves the Stage Thread the run works in. */
  abstract saveThread(runId: string, threadId: string): Promise<void>;

  /** Saves the commit The Office left the Task's branch at after the run. */
  abstract saveHeadCommit(runId: string, headCommit: string): Promise<void>;

  /** Saves the Project commands The Office ran for the run, replacing those saved before. */
  abstract saveCommandRuns(runId: string, commandRuns: readonly StageCommandRun[]): Promise<void>;

  /** Saves the run's tokens so far, replacing those saved before. */
  abstract saveTokens(runId: string, tokens: StageTokens): Promise<void>;

  /** Saves the Decisions the walk opened on the run, replacing those saved before. */
  abstract saveDecisions(runId: string, decisions: readonly StageRunDecision[]): Promise<void>;

  /** Saves how the run ended. */
  abstract saveEnded(run: StageRun): Promise<void>;

  /** The Task's runs, oldest first. */
  abstract list(taskId: string): Promise<readonly StageRun[]>;
}
