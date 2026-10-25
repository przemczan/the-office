/**
 * Who is at work in an engine session, for the Office tools that capture Ideas and create Tasks in
 * their name. Conversations keeps the chats' sessions; the composition root binds it.
 */
export abstract class SessionPeople {
  /** The key of the Role the session's person fills; undefined for a session nobody keeps. */
  abstract personInSession(sessionId: string): Promise<string | undefined>;
}
