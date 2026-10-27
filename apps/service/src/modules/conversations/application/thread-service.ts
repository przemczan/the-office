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
  startTaskThread,
  type TaskThreadStart,
} from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadRunner } from "./thread-runner.js";

/** A Thread The Office opens on a Task, and what it asks the person first. */
export interface TaskThreadOpening extends TaskThreadStart {
  readonly opening: string;
}

/**
 * The Conversations use cases: Threads in their homes, and The Office's log of each. Each change is
 * saved first and its event published after, so nothing hears of a change that wasn't kept.
 */
@Injectable()
export class ThreadService {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly runner: ThreadRunner,
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
   * Opens a Thread on a Task, such as its planning Thread, where the person starts on `opening` at
   * once, in a new session with the Task's Brief. Refused when nobody fills the Role.
   */
  async startOnTask({ opening, ...start }: TaskThreadOpening): Promise<Thread> {
    if (!(await this.roleCards.find(start.roleKey))) {
      throw new ThreadRefused([
        `Nobody fills the Role "${start.roleKey}" yet: hire them on People.`,
      ]);
    }
    const { thread, event } = startTaskThread(randomUUID(), start, new Date());
    await this.repository.add(thread);
    await this.events.publish(event);
    return this.runner.open(thread.id, opening);
  }

  /**
   * The Threads of the person's chat, the newest first. They stay readable after Chat is switched
   * off (spec §2.2).
   */
  listInChat(roleKey: string): Promise<readonly Thread[]> {
    return this.repository.listIn({ kind: "chat", roleKey });
  }

  /** The Threads on a Task, the newest first; none for a Task The Office doesn't know. */
  listOnTask(taskId: string): Promise<readonly Thread[]> {
    return this.repository.listIn({ kind: "task", taskId });
  }

  /** The Threads with the person on every Task, the newest first: their part in those Tasks. */
  listOnTasksWith(roleKey: string): Promise<readonly Thread[]> {
    return this.repository.listOnTasksWith(roleKey);
  }

  /**
   * Whose engine session `sessionId` is, by the key of the Role they fill, for the Office tools a
   * session calls, in a chat or on a Task, a Stage Thread's too; undefined when no Thread has
   * that session now.
   */
  async personInSession(sessionId: string): Promise<string | undefined> {
    return (await this.repository.findBySession(sessionId))?.session?.roleKey;
  }

  /**
   * The Task whose Thread has the engine session `sessionId` now, for the Office tools that write
   * onto a Task's record; undefined for a chat's session or one no Thread has.
   */
  async taskInSession(sessionId: string): Promise<string | undefined> {
    const home = (await this.repository.findBySession(sessionId))?.home;
    return home?.kind === "task" ? home.taskId : undefined;
  }

  /** The Idea the person captured, as its card in the chat whose session is `sessionId`. */
  async postIdeaCard(sessionId: string, ideaId: string): Promise<void> {
    await this.postInChat(sessionId, (roleKey) => ({ kind: "idea", roleKey, ideaId }));
  }

  /** The Office status, as its card in the chat whose session is `sessionId`. */
  async postOfficeStatus(sessionId: string): Promise<void> {
    await this.postInChat(sessionId, (roleKey) => ({ kind: "office-status", roleKey }));
  }

  /**
   * Logs the person's card in the chat Thread with the session; a card belongs in a chat only, so
   * none is logged for a session on a Task or one no Thread has.
   */
  private async postInChat(
    sessionId: string,
    card: (roleKey: string) => MessageDraft,
  ): Promise<void> {
    const thread = await this.repository.findBySession(sessionId);
    if (thread?.home.kind !== "chat") return;
    await this.log(thread.id, [card(thread.roleKey)]);
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
