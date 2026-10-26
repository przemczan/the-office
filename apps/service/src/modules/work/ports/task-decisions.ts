/** The Decisions on Tasks' conversations, which Conversations keeps; the composition root binds it. */
export abstract class TaskDecisions {
  /** How many Decisions on the Task wait on the user. */
  abstract openOn(taskId: string): Promise<number>;
}
