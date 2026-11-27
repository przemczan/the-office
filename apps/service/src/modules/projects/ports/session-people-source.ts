import type { ActingUser } from "../domain/acted-by.js";

/**
 * Who is at work in an engine session, for the Office actions of Projects a person calls. The
 * module keeping every Thread's session gives it as it starts.
 */
export interface SessionPeopleSource {
  /** The key of the Role the session's person fills; undefined for a session nobody keeps. */
  personInSession(sessionId: string): Promise<string | undefined>;

  /** The Task whose Thread the session is; undefined for a chat's or an Initiative's. */
  taskInSession(sessionId: string): Promise<string | undefined>;

  /** The user who wrote the newest user message of the session's Thread; undefined if none. */
  askedByInSession(sessionId: string): Promise<ActingUser | undefined>;
}
