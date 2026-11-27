import type { UserRef } from "../domain/user.js";

/**
 * Who is behind an engine session, for the Office actions of the skill library an Agent calls. The
 * module keeping every Thread's session gives it as it starts.
 */
export interface SessionPeopleSource {
  /** The user who wrote the newest user message of the session's Thread; undefined if none. */
  askedByInSession(sessionId: string): Promise<UserRef | undefined>;
}
