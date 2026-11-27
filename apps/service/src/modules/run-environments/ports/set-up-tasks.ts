import type { ActedBy } from "../../projects/index.js";
import type { OffBoardTaskStart } from "../../work/index.js";

/** A Project's "Set up the run environment" Task, as Work keeps it. */
export interface SetUpTask {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly state: string;
}

/**
 * The "Set up the run environment" Tasks, Off-board Tasks Work makes, starts at once and keeps, at
 * most one open per Project.
 */
export abstract class SetUpTasks {
  /** The Project's open one, neither Done nor Dropped; undefined when it has none. */
  abstract openOf(projectId: string): Promise<SetUpTask | undefined>;

  /**
   * The Project's open one, or one made now, as `by` asked, and started at once or queued; a
   * refused start makes none and answers why.
   */
  abstract add(projectId: string, by: ActedBy): Promise<OffBoardTaskStart>;

  /** Undefined when the Task isn't a set-up Task. */
  abstract setUpTaskOf(taskId: string): Promise<SetUpTask | undefined>;
}
