/**
 * Who is at work in an engine session, for the Office actions of People a person calls. The
 * module keeping every Thread's session gives it as it starts.
 */
export interface SessionPeopleSource {
  /** The key of the Role the session's person fills; undefined for a session nobody keeps. */
  personInSession(sessionId: string): Promise<string | undefined>;
}
