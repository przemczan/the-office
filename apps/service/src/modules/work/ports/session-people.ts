import type { UserRef } from "../domain/author.js";

/**
 * Who is at work in an engine session, for the Office tools that act in their name, such as
 * capturing an Idea or attaching a file. Conversations keeps every Thread's session, a chat's or a
 * Stage's; the composition root binds it.
 */
export abstract class SessionPeople {
  /** The key of the Role the session's person fills; undefined for a session nobody keeps. */
  abstract personInSession(sessionId: string): Promise<string | undefined>;

  /**
   * The user who wrote the newest user message of the session's Thread, the user behind what the
   * person does in it; undefined when no user wrote one, or for a session nobody keeps.
   */
  abstract askedByInSession(sessionId: string): Promise<UserRef | undefined>;
}
