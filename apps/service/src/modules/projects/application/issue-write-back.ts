import type { IssueDropReason } from "../domain/issue-link.js";

/**
 * What Work tells Projects of a Task imported from an issue, so Projects writes back on the issue
 * as the Project's switches say: a comment when it starts and when it is Done, a close when it is
 * Done or Dropped, and the issue opened again when a Drop closed it and the Task is reopened. A
 * Task with no issue link is passed over. Work forwards its own events here.
 */
export abstract class IssueWriteBack {
  /** The Task, titled `title`, started (its first Start). */
  abstract taskStarted(taskId: string, title: string): Promise<void>;

  /** The Task moved to Done. */
  abstract taskDone(taskId: string): Promise<void>;

  /** The Task moved to Dropped, with its drop reason, or null when none was given. */
  abstract taskDropped(taskId: string, dropReason: IssueDropReason | null): Promise<void>;

  /** The Dropped Task was reopened: an issue its Drop closed is opened again. */
  abstract taskReopened(taskId: string): Promise<void>;
}
