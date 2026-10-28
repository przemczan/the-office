/**
 * Which Initiative an engine session shapes, for the Office tools the CTO writes onto it with.
 * Conversations keeps the sessions of Threads on Initiatives; the composition root binds it.
 */
export abstract class SessionInitiatives {
  /** The id of the Initiative the session's Thread is on; undefined for any other session. */
  abstract initiativeInSession(sessionId: string): Promise<string | undefined>;
}
