/**
 * The Decisions that hold Tasks paused for lack of people, kept in Pipelines. A Task has at most
 * one: while it waits, the Task isn't paused again for the same lack.
 */
export abstract class StaffingHoldRepository {
  /** Whether the Task waits on a Decision now. */
  abstract isHeld(taskId: string): Promise<boolean>;

  /** Keeps the Decision the Task waits on. */
  abstract hold(taskId: string, decisionId: string): Promise<void>;

  /** Lets the Decision go and returns its Task; undefined when it holds none. */
  abstract release(decisionId: string): Promise<string | undefined>;
}
