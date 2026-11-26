import type { AttachmentOwner } from "../domain/attachment.js";

/**
 * Which Task an engine session works on, and where the images the user sent in its Thread are kept,
 * for the Office tools that write onto a Task's record. Conversations keeps the sessions of
 * Threads; the composition root binds it.
 */
export abstract class SessionTasks {
  /** The id of the Task the session's Thread is on; undefined for a chat or an unknown session. */
  abstract taskInSession(sessionId: string): Promise<string | undefined>;

  /**
   * What owns the images the user sent in the session's Thread: its Task or Initiative, or the
   * Thread itself in a chat; undefined for an unknown session.
   */
  abstract imageOwnerInSession(sessionId: string): Promise<AttachmentOwner | undefined>;
}
