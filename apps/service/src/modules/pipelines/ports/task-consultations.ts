/** A Consultation on a Task, as Pipelines acts for its Consultant's session. */
export interface TaskConsultation {
  readonly taskId: string;
  /** The Decision the Consultant answers, which The Office's lines about the Consultation name. */
  readonly decisionId: string;
  /** The Thread that asked and waits on the Decision, such as a running Stage's Stage Thread. */
  readonly askingThreadId: string;
  readonly consultant: { readonly name: string; readonly roleTitle: string };
  /** The Consultant's card has the Run environment capability now. */
  readonly runEnvironment: boolean;
}

/**
 * Conversations' Consultations on Tasks, for the Office tools a Consultant calls on the Task's
 * behalf (spec §6); the composition root binds it.
 */
export abstract class TaskConsultations {
  /** The Consultation on a Task whose session this is; undefined for any other session. */
  abstract consultationOnTask(sessionId: string): Promise<TaskConsultation | undefined>;

  /**
   * The Office's line about the Consultation of `decisionId` in `threadId`, kept as the
   * Consultation's lines are: a Stage Thread's Stage history shows it.
   */
  abstract logOfficeLine(threadId: string, decisionId: string, text: string): Promise<void>;
}
