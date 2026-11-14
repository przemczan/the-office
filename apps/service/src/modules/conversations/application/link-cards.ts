import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import { linkCardNote, type LinkedTask } from "../domain/link-card.js";
import type { Message } from "../domain/message.js";
import type { Thread } from "../domain/thread.js";
import { logMessages } from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { WorkRecords } from "./work-records.js";

/** Whom a Link card points to: a person, a Task, or a Task and the person to ask about it. */
export interface LinkCardRequest {
  /** The person's Role key; about a Task, left out for whoever works its latest Stage. */
  readonly to: string | undefined;
  readonly taskId: string | undefined;
  readonly note: string;
}

type LinkCardMessage = Extract<Message, { kind: "link-card" }>;

/**
 * Link cards (spec §2.2): the Default person to talk to points the user to whoever is responsible,
 * with a Handover note the user may edit or drop, and sends themselves; the Default person to talk
 * to never relays.
 */
@Injectable()
export class LinkCards {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly work: WorkRecords,
    private readonly events: EventBus,
  ) {}

  /**
   * Posts the card in the Thread whose engine session is `sessionId`. Refused, with the reasons the
   * person acts on, when there is nobody to open a chat Thread with or no such Task.
   */
  async post(sessionId: string, request: LinkCardRequest): Promise<LinkCardMessage> {
    const thread = await this.repository.findBySession(sessionId);
    if (!thread) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const task = await this.taskOf(request.taskId);
    const to = request.to ?? (await this.workingOn(task));
    await this.refuseUnlessReachable(to, thread);
    if (request.note.trim() === "") {
      throw new ThreadRefused(["Write the Handover note: a line or two the user can send."]);
    }
    const card: LinkCardMessage = {
      kind: "link-card",
      id: randomUUID(),
      threadId: thread.id,
      at: new Date(),
      roleKey: thread.roleKey,
      to,
      taskId: task?.taskId,
      note: linkCardNote(request.note, task),
    };
    const { event } = await this.repository.update(thread.id, (latest) =>
      logMessages(latest, [card], card.at),
    );
    if (event) await this.events.publish(event);
    return card;
  }

  /** The people the log's Link cards point to who have been let go since, by their Role's key. */
  async letGoIn(messages: readonly Message[]): Promise<ReadonlySet<string>> {
    const pointedTo = messages.flatMap((message) =>
      message.kind === "link-card" ? [message.to] : [],
    );
    if (pointedTo.length === 0) return new Set();
    const hired = await this.roleCards.hiredKeys();
    return new Set(pointedTo.filter((roleKey) => !hired.has(roleKey)));
  }

  private async taskOf(taskId: string | undefined): Promise<LinkedTask | undefined> {
    if (taskId === undefined) return undefined;
    const title = await this.work.taskTitle(taskId);
    if (title === undefined) throw new ThreadRefused([`The Office has no Task ${taskId}.`]);
    return { taskId, title };
  }

  /** Whoever works the Task's latest Stage, by its newest Stage Thread. */
  private async workingOn(task: LinkedTask | undefined): Promise<string> {
    if (!task) throw new ThreadRefused(["Name the person or the Task to point the user to."]);
    const threads = await this.repository.listIn({ kind: "task", taskId: task.taskId });
    const stageThread = threads.find((thread) => thread.stageThread);
    if (!stageThread) {
      throw new ThreadRefused([
        `Nobody has worked a Stage of ${task.title} yet: name the person to point the user to.`,
      ]);
    }
    return stageThread.roleKey;
  }

  private async refuseUnlessReachable(roleKey: string, thread: Thread): Promise<void> {
    if (roleKey === thread.roleKey) {
      throw new ThreadRefused(["The user is talking to you already: point them to someone else."]);
    }
    const person = await this.roleCards.find(roleKey);
    if (!person) {
      const letGo = await this.roleCards.findLetGo(roleKey);
      throw new ThreadRefused([
        letGo
          ? `${letGo.name} was let go: point the user to someone hired.`
          : `Nobody fills the Role "${roleKey}": list_people names who is hired.`,
      ]);
    }
    const { name, capabilities } = person.card;
    if (!capabilities.chat) {
      throw new ThreadRefused([
        `Chat is off for ${name}, so the user can't open a Thread with them: point to someone else.`,
      ]);
    }
  }
}
