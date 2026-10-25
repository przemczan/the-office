import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import { ChatNotFound } from "../domain/chat-not-found.js";
import type { Message, MessageDraft } from "../domain/message.js";
import type { Thread } from "../domain/thread.js";
import { logMessages, renameThread, startChatThread } from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/**
 * The Conversations use cases: Threads in their homes, and The Office's log of each. Each change is
 * saved first and its event published after, so nothing hears of a change that wasn't kept.
 */
@Injectable()
export class ThreadService {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly events: EventBus,
  ) {}

  /** A fresh Thread in the person's chat; refused when their Chat is off. */
  async startInChat(roleKey: string): Promise<Thread> {
    const role = await this.roleCards.find(roleKey);
    if (!role) throw new ChatNotFound(roleKey);
    const person = { roleKey, name: role.card.name, chat: role.card.capabilities.chat };
    const { thread, event } = startChatThread(randomUUID(), person, new Date());
    await this.repository.add(thread);
    await this.events.publish(event);
    return thread;
  }

  /**
   * The Threads of the person's chat, the newest first. They stay readable after Chat is switched
   * off (spec §2.2).
   */
  listInChat(roleKey: string): Promise<readonly Thread[]> {
    return this.repository.listIn({ kind: "chat", roleKey });
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

  async messages(id: string): Promise<readonly Message[]> {
    await this.read(id);
    return this.repository.messages(id);
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
