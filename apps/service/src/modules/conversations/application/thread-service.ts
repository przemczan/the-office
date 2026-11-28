import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import { ChatNotFound } from "../domain/chat-not-found.js";
import type { Message, MessageDraft } from "../domain/message.js";
import type { ContextOverride, Thread } from "../domain/thread.js";
import {
  chooseOverride,
  logMessages,
  renameThread,
  startChatThread,
} from "../domain/thread-changes.js";
import { MessageNotFound } from "../domain/message-not-found.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/**
 * The Conversations use cases of the Threads page: a person's chat Threads, the Threads in each
 * home, and The Office's log of each. Each change is saved first and its event published after,
 * so nothing hears of a change that wasn't kept.
 */
@Injectable()
export class ThreadService {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly events: EventBus,
  ) {}

  /**
   * A fresh Thread in the person's chat, titled `title` when The Office names it, with no message
   * sent; refused when their Chat is off.
   */
  async startInChat(roleKey: string, title?: string): Promise<Thread> {
    const role = await this.roleCards.find(roleKey);
    if (!role) throw new ChatNotFound(roleKey);
    const person = { roleKey, name: role.card.name, chat: role.card.capabilities.chat };
    const { thread, event } = startChatThread(randomUUID(), person, new Date(), title);
    await this.repository.add(thread);
    await this.events.publish(event);
    return thread;
  }

  /** The Threads on a Task, the newest first; none for a Task The Office doesn't know. */
  listOnTask(taskId: string): Promise<readonly Thread[]> {
    return this.repository.listIn({ kind: "task", taskId });
  }

  /** The Threads on an Initiative, the newest first; none for one The Office doesn't know. */
  listOnInitiative(initiativeId: string): Promise<readonly Thread[]> {
    return this.repository.listIn({ kind: "initiative", initiativeId });
  }

  async read(id: string): Promise<Thread> {
    const thread = await this.repository.find(id);
    if (!thread) throw new ThreadNotFound(id);
    return thread;
  }

  async rename(id: string, title: string): Promise<Thread> {
    const { thread, event } = await this.repository.update(id, (current) =>
      renameThread(current, title, new Date()),
    );
    if (event) await this.events.publish(event);
    return thread;
  }

  /** "Start fresh" or "Continue anyway" for the next message; undefined goes back to the policy. */
  async chooseOverride(id: string, override: ContextOverride | undefined): Promise<Thread> {
    const { thread, event } = await this.repository.update(id, (current) =>
      chooseOverride(current, override, new Date()),
    );
    if (event) await this.events.publish(event);
    return thread;
  }

  /** The Thread's log, or only what was logged after the message `after` when it names one. */
  async messages(id: string, after?: string): Promise<readonly Message[]> {
    await this.read(id);
    if (after === undefined) return this.repository.messages(id);
    const later = await this.repository.messagesAfter(id, after);
    if (later === undefined) throw new MessageNotFound(id, after);
    return later;
  }

  /** Adds the drafts to the Thread's log, in order, each with an id and the time now. */
  async log(id: string, drafts: readonly MessageDraft[]): Promise<readonly Message[]> {
    const at = new Date();
    const messages = drafts.map((draft): Message => ({
      ...draft,
      id: randomUUID(),
      threadId: id,
      at,
    }));
    const { event } = await this.repository.update(id, (thread) =>
      logMessages(thread, messages, at),
    );
    if (event) await this.events.publish(event);
    return messages;
  }
}
