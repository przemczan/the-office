import { Injectable } from "@nestjs/common";
import type { MessageDraft } from "../domain/message.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadService } from "./thread-service.js";

/**
 * The cards other modules' Office tools post into the Thread whose session called them: the Idea a
 * person captured, the Office status.
 */
@Injectable()
export class ThreadCards {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly threads: ThreadService,
  ) {}

  /** The Idea the person captured, as its card in the Thread whose session is `sessionId`. */
  async postIdeaCard(sessionId: string, ideaId: string): Promise<void> {
    await this.postInPersonsThread(sessionId, (roleKey) => ({ kind: "idea", roleKey, ideaId }));
  }

  /** The Office status, as its card in the Thread whose session is `sessionId`. */
  async postOfficeStatus(sessionId: string): Promise<void> {
    await this.postInPersonsThread(sessionId, (roleKey) => ({ kind: "office-status", roleKey }));
  }

  /**
   * Logs the person's card in the Thread with the session, in any Thread the user talks to them in
   * (spec §6, "A person's Office tools"); none for a Stage's Thread, which does its Stage's work
   * only, or a session no Thread has.
   */
  private async postInPersonsThread(
    sessionId: string,
    card: (roleKey: string) => MessageDraft,
  ): Promise<void> {
    const thread = await this.repository.findBySession(sessionId);
    if (thread === undefined || thread.stageThread) return;
    await this.threads.log(thread.id, [card(thread.roleKey)]);
  }
}
