/**
 * Who is at work in an engine session, for the Office actions Devices carries out in their name.
 * Conversations keeps every Thread's session; the composition root binds it.
 */
export abstract class SessionPeople {
  /** The key of the Role the session's person fills; undefined for a session nobody keeps. */
  abstract personInSession(sessionId: string): Promise<string | undefined>;

  /** The user who wrote the newest user message of the session's Thread; undefined if none. */
  abstract askedByInSession(
    sessionId: string,
  ): Promise<{ readonly userId: string; readonly name: string } | undefined>;
}
