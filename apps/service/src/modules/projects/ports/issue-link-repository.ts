import type { IssueLink, IssueWriteBackEntry } from "../domain/issue-link.js";

/**
 * Where the issues imported as Tasks are kept, and the outbox of what to write on them. Links are
 * never deleted once their Task is made: their remote and number import each issue once.
 */
export abstract class IssueLinkRepository {
  /**
   * Claims the issue for an import: keeps the link, its Task not made yet. False when its remote's
   * issue is already linked, claimed or imported, by this import or any other.
   */
  abstract claim(link: IssueLink): Promise<boolean>;

  /** Names the Task made for a claimed link. */
  abstract attachTask(id: string, taskId: string): Promise<void>;

  /** Removes a claim whose Task wasn't made, so a later import can try again; never a link with a Task. */
  abstract release(id: string): Promise<void>;

  /** The Task's link; undefined when it wasn't imported from an issue. */
  abstract ofTask(taskId: string): Promise<IssueLink | undefined>;

  /** The links of these Tasks, those that have one. */
  abstract ofTasks(taskIds: readonly string[]): Promise<readonly IssueLink[]>;

  /** The numbers of the remote's issues already linked, claimed or imported. */
  abstract linkedNumbers(remoteUrl: string): Promise<ReadonlySet<number>>;

  /** The Project's links with a Task that hasn't ended, which the watch reads the issue of. */
  abstract watched(projectId: string): Promise<readonly IssueLink[]>;

  /** Keeps when the issue was closed on the host as just read (null while open), and when it was read. */
  abstract markChecked(id: string, closedOnHostAt: Date | null, checkedAt: Date): Promise<void>;

  /** Marks the link's Task Done or Dropped at `at`, unless it already ended. */
  abstract endTask(id: string, at: Date): Promise<void>;

  /** Marks the link's Task open again, as it was reopened, so the watch reads its issue again. */
  abstract reopenTask(id: string): Promise<void>;

  /** Every write-back of the link, done or not, oldest first. */
  abstract writeBacksOf(issueLinkId: string): Promise<readonly IssueWriteBackEntry[]>;

  /** Adds write-backs to the outbox. */
  abstract addWriteBacks(entries: readonly IssueWriteBackEntry[]): Promise<void>;

  /** The link's write-backs not done yet, oldest first. */
  abstract pendingWriteBacks(issueLinkId: string): Promise<readonly IssueWriteBackEntry[]>;

  /** The Project's links with a write-back not done that was made at `since` or later. */
  abstract withPendingWriteBacks(projectId: string, since: Date): Promise<readonly IssueLink[]>;

  /** The write-back went through at `at`. */
  abstract writeBackDone(id: string, at: Date): Promise<void>;

  /** The code host refused the write-back, or couldn't be asked: counted, with why. */
  abstract writeBackFailed(id: string, problem: string): Promise<void>;

  /** Why the link's newest write-back not done last failed; null when none has failed. */
  abstract writeBackProblemOf(issueLinkId: string): Promise<string | null>;
}
