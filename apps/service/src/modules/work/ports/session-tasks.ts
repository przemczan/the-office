/**
 * Which Task an engine session works on, for the Office tools that write onto the Task's record.
 * Conversations keeps the sessions of Threads on Tasks; the composition root binds it.
 */
export abstract class SessionTasks {
  /** The id of the Task the session's Thread is on; undefined for a chat or an unknown session. */
  abstract taskInSession(sessionId: string): Promise<string | undefined>;
}
