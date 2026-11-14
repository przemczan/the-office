/** A Thread on an Initiative, by its id and the Initiative's. */
export interface SessionInitiativeThread {
  readonly threadId: string;
  readonly initiativeId: string;
}

/**
 * Which Initiative an engine session works on, for the Office tools it is shaped with and the
 * Planner plans its Tasks with. Conversations keeps the sessions of Threads on Initiatives; the
 * composition root binds it.
 */
export abstract class SessionInitiatives {
  /** The id of the Initiative the session's Thread is on; undefined for any other session. */
  abstract initiativeInSession(sessionId: string): Promise<string | undefined>;

  /** The Thread on an Initiative the session is in; undefined for any other session. */
  abstract initiativeThreadInSession(
    sessionId: string,
  ): Promise<SessionInitiativeThread | undefined>;
}
