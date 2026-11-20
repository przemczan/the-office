import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import { ChatNotFound } from "../domain/chat-not-found.js";
import type { Message, MessageDraft } from "../domain/message.js";
import { isPersonsThread, type ContextOverride, type Thread } from "../domain/thread.js";
import {
  chooseOverride,
  logMessages,
  renameThread,
  startChatThread,
  startInitiativeThread,
  startTaskThread,
  type InitiativeThreadStart,
  type TaskThreadStart,
} from "../domain/thread-changes.js";
import type { ThreadStarted } from "../domain/conversation-events.js";
import { worksIn } from "../domain/people-working.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository, type TaskThreadTitle } from "../ports/thread-repository.js";
import { ThreadRunner } from "./thread-runner.js";

/** A Thread The Office opens on an Initiative. */
export interface InitiativeThreadWaiting extends InitiativeThreadStart {
  /** The Thread's id, when the caller keeps it before the Thread opens; a new one otherwise. */
  readonly threadId?: string;
}

/** A Thread The Office opens on an Initiative, and what it asks the person first. */
export interface InitiativeThreadOpening extends InitiativeThreadWaiting {
  readonly opening: string;
}

/** A Thread The Office opens on a Task, such as Make a plan's, and what it asks the person first. */
export interface TaskThreadStarting extends TaskThreadStart {
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
   * Opens a Thread on a Task, such as its planning Thread, waiting for the user: the person starts
   * on their first message, in a new session with the Task's Brief. Refused when nobody fills the
   * Role.
   */
  async openOnTask(start: TaskThreadStart): Promise<Thread> {
    await this.refuseUnlessFilled(start.roleKey);
    return this.add(startTaskThread(randomUUID(), start, new Date()));
  }

  /**
   * Opens a Thread on a Task, such as its planning Thread on Make a plan, where the person starts
   * on `opening` at once, in a new session with the Task's Brief. Refused when nobody fills the Role.
   */
  async startOnTask({ opening, ...start }: TaskThreadStarting): Promise<Thread> {
    await this.refuseUnlessFilled(start.roleKey);
    return this.openWith(startTaskThread(randomUUID(), start, new Date()), opening);
  }

  /**
   * Opens a Thread on an Initiative, such as its planning Thread on Plan with…, waiting for the
   * user: the person starts on their first message, in a new session with the Initiative's Brief.
   * Refused when nobody fills the Role.
   */
  async openOnInitiative({
    threadId = randomUUID(),
    ...start
  }: InitiativeThreadWaiting): Promise<Thread> {
    await this.refuseUnlessFilled(start.roleKey);
    return this.add(startInitiativeThread(threadId, start, new Date()));
  }

  /**
   * Opens a Thread on an Initiative, where the person starts on `opening` at once, in a new session
   * with the Initiative's Brief. Refused when nobody fills the Role.
   */
  async startOnInitiative({
    threadId = randomUUID(),
    opening,
    ...start
  }: InitiativeThreadOpening): Promise<Thread> {
    await this.refuseUnlessFilled(start.roleKey);
    return this.openWith(startInitiativeThread(threadId, start, new Date()), opening);
  }

  /** The person's own Thread on a Task, by its id; undefined for any other Thread. */
  async personsThreadOnTask(
    threadId: string,
  ): Promise<{ readonly taskId: string; readonly roleKey: string } | undefined> {
    const thread = await this.repository.find(threadId);
    if (thread?.home.kind !== "task" || !isPersonsThread(thread)) return undefined;
    return { taskId: thread.home.taskId, roleKey: thread.roleKey };
  }

  /**
   * Has the person start again on `opening` in a Thread The Office stopped them in, such as a
   * planning Thread a restart cut short: its session continued or replaced under the Context policy.
   */
  askAgain(threadId: string, opening: string): Promise<Thread> {
    return this.runner.askAgain(threadId, opening);
  }

  private async refuseUnlessFilled(roleKey: string): Promise<void> {
    if (await this.roleCards.find(roleKey)) return;
    throw new ThreadRefused([`Nobody fills the Role "${roleKey}" yet: hire them on People.`]);
  }

  private async openWith(
    started: { readonly thread: Thread; readonly event: ThreadStarted },
    opening: string,
  ): Promise<Thread> {
    const thread = await this.add(started);
    return this.runner.open(thread.id, opening);
  }

  private async add({
    thread,
    event,
  }: {
    readonly thread: Thread;
    readonly event: ThreadStarted;
  }): Promise<Thread> {
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

  /**
   * How many engine sessions are working now, in Stages, chats and Threads: each Thread answering
   * whose person works in it, as the Live view counts them (`worksIn`), so a Stage Thread waiting
   * on its Decision doesn't count.
   */
  async sessionsWorking(): Promise<number> {
    return (await this.repository.answering()).filter(worksIn).length;
  }

  /**
   * The title of each of the person's Threads on a Task, by its Task, the newest first: their part
   * in those Tasks, which their Work tab shows.
   */
  titlesOnTasksWith(roleKey: string): Promise<readonly TaskThreadTitle[]> {
    return this.repository.titlesOnTasksWith(roleKey);
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
