import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import type { ThreadStarted } from "../domain/conversation-events.js";
import { isPersonsThread, type Thread } from "../domain/thread.js";
import {
  startInitiativeThread,
  startTaskThread,
  type InitiativeThreadStart,
  type TaskThreadStart,
} from "../domain/thread-changes.js";
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
 * The Threads on Tasks and Initiatives that The Office opens for the work, such as planning and
 * shaping Threads, and what the module keeping the work reads of them: whose they are, their
 * titles, and the person starting again where a restart cut them short. Each Thread is saved
 * first and its event published after.
 */
@Injectable()
export class WorkThreads {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly runner: ThreadRunner,
    private readonly events: EventBus,
  ) {}

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
   * The title of each of the person's Threads on a Task, by its Task, the newest first: their part
   * in those Tasks, which their Work tab shows.
   */
  titlesOnTasksWith(roleKey: string): Promise<readonly TaskThreadTitle[]> {
    return this.repository.titlesOnTasksWith(roleKey);
  }

  /** The ids of the person's Threads on an Initiative, by their Role's key; Consultations aside. */
  async idsOnInitiativeWith(initiativeId: string, roleKey: string): Promise<readonly string[]> {
    const onInitiative = await this.repository.listIn({ kind: "initiative", initiativeId });
    return onInitiative
      .filter((thread) => thread.roleKey === roleKey && !thread.consultation)
      .map(({ id }) => id);
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
}
