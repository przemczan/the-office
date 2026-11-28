import { Injectable } from "@nestjs/common";
import { latestWriter } from "../domain/message.js";
import { imageOwnerOf, type MessageImageOwner } from "../domain/message-image-owner.js";
import type { UserRef } from "../domain/user.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/**
 * The Thread an engine session is in now, and what of it the Office tools the session calls act
 * on: whose session it is, the user who asked, and the Task or Initiative it is on. Every module
 * whose Office tools or actions act in a person's name reads it.
 */
@Injectable()
export class SessionThreads {
  constructor(private readonly repository: ThreadRepository) {}

  /**
   * Whose engine session `sessionId` is, by the key of the Role they fill, for the Office tools a
   * session calls, in a chat or on a Task, a Stage Thread's too; undefined when no Thread has
   * that session now.
   */
  async personInSession(sessionId: string): Promise<string | undefined> {
    return (await this.repository.findBySession(sessionId))?.session?.roleKey;
  }

  /**
   * The user who wrote the newest user message of the Thread that has the engine session
   * `sessionId` now; undefined when no user wrote one or no Thread has the session.
   */
  async askedByInSession(sessionId: string): Promise<UserRef | undefined> {
    const thread = await this.repository.findBySession(sessionId);
    if (!thread) return undefined;
    return latestWriter(await this.repository.messages(thread.id)) ?? undefined;
  }

  /**
   * The Task whose Thread has the engine session `sessionId` now, for the Office tools that write
   * onto a Task's record; undefined for a chat's session or one no Thread has.
   */
  async taskInSession(sessionId: string): Promise<string | undefined> {
    const home = (await this.repository.findBySession(sessionId))?.home;
    return home?.kind === "task" ? home.taskId : undefined;
  }

  /**
   * What keeps the images the user sent in the Thread that has the engine session `sessionId` now
   * (`imageOwnerOf`), for the Office tool that attaches one to a Task; undefined for an unknown session.
   */
  async imageOwnerInSession(sessionId: string): Promise<MessageImageOwner | undefined> {
    const thread = await this.repository.findBySession(sessionId);
    return thread && imageOwnerOf(thread);
  }

  /**
   * The Initiative whose Thread has the engine session `sessionId` now, for the Office tools that
   * write onto it; undefined for any other session.
   */
  async initiativeInSession(sessionId: string): Promise<string | undefined> {
    const home = (await this.repository.findBySession(sessionId))?.home;
    return home?.kind === "initiative" ? home.initiativeId : undefined;
  }

  /**
   * The Thread on an Initiative that has the engine session `sessionId` now, for the Office tools
   * the Planner plans the Initiative's Tasks with; undefined for any other session.
   */
  async initiativeThreadInSession(
    sessionId: string,
  ): Promise<{ readonly threadId: string; readonly initiativeId: string } | undefined> {
    const thread = await this.repository.findBySession(sessionId);
    if (thread?.home.kind !== "initiative") return undefined;
    return { threadId: thread.id, initiativeId: thread.home.initiativeId };
  }
}
