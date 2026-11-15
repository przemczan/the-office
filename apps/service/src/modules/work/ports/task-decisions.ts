import type { OpenTaskDecision } from "../domain/initiative-planning.js";
import type { DecisionWaitingOnTheUser } from "../domain/record-words.js";

/** The Decisions on Tasks' conversations, which Conversations keeps; the composition root binds it. */
export abstract class TaskDecisions {
  /** How many Decisions on the Task wait on the user. */
  abstract openOn(taskId: string): Promise<number>;
  /**
   * The Decisions waiting on the user in the Thread, the first asked first: in an Initiative's
   * planning Thread, one per Task at most.
   */
  abstract openInThread(threadId: string): Promise<readonly OpenTaskDecision[]>;
  /** The ids of the Tasks a Decision waiting on the user is open on, each once. */
  abstract tasksWithOpenDecisions(): Promise<readonly string[]>;
  /** The Decisions on the Task waiting on the user, in any of its Threads, the first asked first. */
  abstract waitingOnTheUserOn(taskId: string): Promise<readonly DecisionWaitingOnTheUser[]>;
  /**
   * Closes every Decision still open on the dropped Task, waiting on the user or put to a
   * Consultant, in any of its Threads; nothing when none is.
   */
  abstract closeOnDroppedTask(taskId: string): Promise<void>;
}
