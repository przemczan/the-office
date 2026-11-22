import type { OffBoardStageRun } from "../domain/off-board-task.js";
import type { AllStageResults } from "../domain/record-words.js";

/** What a Task's Stages did, for the Brief of a person's Thread on it. */
export interface TaskStageResults {
  /** Each run's result as a line of a Brief, in the order they ran. */
  readonly lines: readonly string[];
  /** The Handover notes of the person's own runs, in the order they ran. */
  readonly handoverNotes: readonly string[];
}

/** A Task's own Stages and its Stage runs, outlined for its Off-board Task's card. */
export interface TaskStageRunsOutline {
  readonly taskId: string;
  /** The Task's own Stage names in order; undefined before its Stages are made. */
  readonly stages: readonly string[] | undefined;
  /** In the order they ran. */
  readonly runs: readonly OffBoardStageRun[];
}

/**
 * The Tasks' Stage results, which the Pipelines module keeps. A port rather than that module
 * itself, because Pipelines calls Work: the composition root binds it.
 */
export abstract class StageResults {
  abstract of(taskId: string, roleKey: string): Promise<TaskStageResults>;
  abstract ofTask(taskId: string): Promise<AllStageResults>;
  /** One outline for each of `taskIds`, in their order. */
  abstract outlinesOf(taskIds: readonly string[]): Promise<readonly TaskStageRunsOutline[]>;
}
