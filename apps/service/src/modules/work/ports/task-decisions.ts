import type { OpenTaskDecision } from "../domain/initiative-planning.js";

/** The Decisions on Tasks' conversations, which Conversations keeps; the composition root binds it. */
export abstract class TaskDecisions {
  /** How many Decisions on the Task wait on the user. */
  abstract openOn(taskId: string): Promise<number>;
  /**
   * The Decisions waiting on the user in the Thread, the first asked first: in an Initiative's
   * planning Thread, one per Task at most.
   */
  abstract openInThread(threadId: string): Promise<readonly OpenTaskDecision[]>;
}
