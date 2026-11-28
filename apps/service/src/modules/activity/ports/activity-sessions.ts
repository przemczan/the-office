import type { ActivityThreadSession } from "../domain/activity.js";

/** The user's active sessions of people, which Conversations keeps; the composition root binds it. */
export abstract class ActivitySessions {
  /** The sessions active now, the user's own chats among them and never another user's. */
  abstract sessionsFor(userId: string): Promise<readonly ActivityThreadSession[]>;
}
