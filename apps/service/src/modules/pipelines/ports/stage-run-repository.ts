import type { StageCommandRun } from "../domain/stage-command-run.js";
import type {
  GateAction,
  StageRun,
  StageRunDecision,
  StageSessionMove,
  StageTokens,
  AskedInterruption,
  UsageWindowReading,
} from "../domain/stage-run.js";

/** The Stage Thread a run works in, how its session began, and what the session runs on. */
export interface StageRunThread {
  readonly threadId: string;
  readonly session: StageSessionMove;
  readonly engine: string;
  readonly model: string;
}

/** When a run's usage windows were read: after its session opened, or after its last turn. */
export type UsageWindowsMoment = "start" | "end";

/** Where each Task's Stage runs are kept. */
export abstract class StageRunRepository {
  /**
   * Saves a run that has just started; false when the Task already has a run of that number, so two
   * walks of one Task can't both go on.
   */
  abstract saveNew(run: StageRun): Promise<boolean>;

  abstract saveThread(runId: string, thread: StageRunThread): Promise<void>;

  abstract saveUsageWindows(
    runId: string,
    moment: UsageWindowsMoment,
    reading: UsageWindowReading,
  ): Promise<void>;

  /** Saves the commit The Office left the Task's branch at after the run. */
  abstract saveHeadCommit(runId: string, headCommit: string): Promise<void>;

  /** Saves the Project commands The Office ran for the run, replacing those saved before. */
  abstract saveCommandRuns(runId: string, commandRuns: readonly StageCommandRun[]): Promise<void>;

  /** Saves the run's tokens so far, replacing those saved before. */
  abstract saveTokens(runId: string, tokens: StageTokens): Promise<void>;

  /** Saves the Decisions the walk opened on the run, replacing those saved before. */
  abstract saveDecisions(runId: string, decisions: readonly StageRunDecision[]): Promise<void>;

  /** Saves what the user asked of the run while it runs, replacing what they asked before. */
  abstract saveHeldBy(runId: string, heldBy: AskedInterruption): Promise<void>;

  /**
   * Saves what the user did at a Gate's run; false when an action was saved first, as each Gate
   * run takes one.
   */
  abstract saveGateAction(runId: string, gateAction: GateAction): Promise<boolean>;

  /** Saves how the run ended. */
  abstract saveEnded(run: StageRun): Promise<void>;

  /** The Task's runs, oldest first. */
  abstract list(taskId: string): Promise<readonly StageRun[]>;
}
