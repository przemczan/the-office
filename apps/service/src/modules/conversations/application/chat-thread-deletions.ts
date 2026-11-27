import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ThreadDeleted } from "../domain/conversation-events.js";
import { deletionLockWords } from "../domain/deletion-lock.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ChatActivity } from "./chat-activity.js";
import { DecisionService } from "./decision-service.js";
import { MessageImages } from "./message-images.js";
import { ProposalService } from "./proposal-service.js";
import { ThreadRunner } from "./thread-runner.js";

/**
 * Deletes a person's chat Threads (spec §2.4.1, "Deleting a chat Thread"): all or nothing. A
 * running answer is stopped first, a Decision waiting in a Thread is withdrawn and its open
 * Proposals are declined; then its messages, images, context choice, what the user saw of it, its
 * Sub-agents and Processes and its engine session go. What was made in it stays: Tasks, Ideas,
 * Memory notes and applied Proposals, and its tokens in the Stats.
 */
@Injectable()
export class ChatThreadDeletions {
  private readonly logger = new Logger(ChatThreadDeletions.name);

  constructor(
    private readonly repository: ThreadRepository,
    private readonly runner: ThreadRunner,
    private readonly decisions: DecisionService,
    private readonly proposals: ProposalService,
    private readonly chatActivity: ChatActivity,
    private readonly images: MessageImages,
    private readonly events: EventBus,
  ) {}

  /**
   * Deletes the Threads, each in the chat of the person `roleKey`. Refused, with every reason and
   * nothing deleted, when one isn't there, isn't in that person's chat or can't be deleted yet.
   */
  async delete(roleKey: string, threadIds: readonly string[]): Promise<void> {
    const threads = await this.checked(roleKey, [...new Set(threadIds)]);
    for (const thread of threads) await this.deleteOne(thread);
  }

  private async checked(roleKey: string, threadIds: readonly string[]): Promise<readonly Thread[]> {
    const found = await Promise.all(threadIds.map((id) => this.repository.find(id)));
    const problems: string[] = [];
    const threads: Thread[] = [];
    found.forEach((thread, index) => {
      if (!thread) {
        problems.push(`Thread ${threadIds[index]} doesn't exist, or was deleted already.`);
      } else if (thread.home.kind !== "chat" || thread.home.roleKey !== roleKey) {
        problems.push(`${nameOf(thread)} isn't in this person's chat, so it can't be deleted.`);
      } else {
        threads.push(thread);
      }
    });
    const locks = await this.chatActivity.deletionLocksOf(threads);
    for (const thread of threads) {
      const lock = locks.get(thread.id);
      if (lock)
        problems.push(`${nameOf(thread)} can't be deleted yet: ${deletionLockWords(lock)}.`);
    }
    if (problems.length > 0) throw new ThreadRefused(problems);
    return threads;
  }

  private async deleteOne(checked: Thread): Promise<void> {
    // Read again: the Thread moved while the others were deleted.
    const thread = (await this.repository.find(checked.id)) ?? checked;
    await this.runner.endForDeletion(thread);
    await this.decisions.closeInDeletedThread(thread.id);
    await this.proposals.declineInDeletedThread(thread.id);
    await this.images.removeKeptBy(thread.id).catch((error: unknown) => {
      this.logger.warn(`Thread ${thread.id}'s images stay: ${messageOf(error)}`);
    });
    if (await this.repository.remove(thread.id)) {
      await this.events.publish(new ThreadDeleted(thread, new Date()));
    }
  }
}

function nameOf({ title }: Thread): string {
  return title ? `"${title}"` : "A Thread with no title";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
