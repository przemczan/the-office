import { Injectable } from "@nestjs/common";
import { RoleCards } from "../../people/index.js";
import { conversationTabs, type ConversationTab } from "../domain/conversation-tabs.js";
import type { Decision } from "../domain/decision.js";
import { peopleWorkingOnTasks, type TaskPeopleWorking } from "../domain/people-working.js";
import type { Thread } from "../domain/thread.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { ThreadService } from "./thread-service.js";

const NO_TAB = "This person has no tab on this Task.";
const PLANNED_IN_THE_INITIATIVE =
  "This Task is being planned in its Initiative's planning Thread: carry on there.";

/** A Task's conversation: one tab per person, each with their one Thread on it (spec §2.4). */
@Injectable()
export class TaskConversations {
  /** Threads being opened, so two calls for one tab open one Thread. */
  private readonly opening = new Map<string, Promise<Thread>>();

  constructor(
    private readonly repository: ThreadRepository,
    private readonly threads: ThreadService,
    private readonly roleCards: RoleCards,
    private readonly taskThreads: TaskThreadSetups,
    private readonly briefs: Briefs,
  ) {}

  async tabs(taskId: string): Promise<readonly ConversationTab[]> {
    const threads = await this.repository.listIn({ kind: "task", taskId });
    const [planner, decisions, elsewhere] = await Promise.all([
      this.taskThreads.planner(),
      this.consultedDecisions(threads),
      this.taskThreads.planningThreadElsewhere(taskId),
    ]);
    return conversationTabs(planner, threads, decisions, elsewhere);
  }

  /** Who is working on each Task right now, in one read for the whole board. */
  async peopleWorking(): Promise<readonly TaskPeopleWorking[]> {
    return peopleWorkingOnTasks(await this.repository.answering());
  }

  /**
   * What the first session of a Thread still to be opened would take, in tokens. Apart from the
   * tabs: it reads the Task's diff, and the tabs are read again at every Thread event.
   */
  async firstBriefTokens(taskId: string, roleKey: string): Promise<number> {
    const tabs = await this.tabs(taskId);
    if (!tabs.some((tab) => tab.roleKey === roleKey)) throw new ThreadRefused([NO_TAB]);
    return (await this.briefs.forPersonsFirstSession(taskId, roleKey)).tokens;
  }

  /**
   * The person's Thread on the Task, opened the first time: refused for someone with no tab, and
   * by the module keeping Tasks once the Task has ended or before it can have one.
   */
  async openThread(taskId: string, roleKey: string): Promise<Thread> {
    const key = `${taskId}/${roleKey}`;
    const running = this.opening.get(key);
    if (running) return running;
    const opened = this.findOrOpen(taskId, roleKey).finally(() => this.opening.delete(key));
    this.opening.set(key, opened);
    return opened;
  }

  private async findOrOpen(taskId: string, roleKey: string): Promise<Thread> {
    const tab = (await this.tabs(taskId)).find((candidate) => candidate.roleKey === roleKey);
    if (!tab) throw new ThreadRefused([NO_TAB]);
    // The Initiative's planning Thread is the Task's planning Thread meanwhile: no second one opens.
    if (tab.planningThreadElsewhere) throw new ThreadRefused([PLANNED_IN_THE_INITIATIVE]);
    if (tab.threadId !== undefined) return this.existing(tab.threadId);
    const refusal = await this.taskThreads.readyForPersonsThread(taskId);
    if (refusal !== undefined) throw new ThreadRefused([refusal]);
    const person = await this.roleCards.find(roleKey);
    if (!person) throw new ThreadRefused(["Nobody fills this Thread's Role any more."]);
    return this.threads.openOnTask({ taskId, roleKey, title: `Asking ${person.card.name}` });
  }

  private async existing(threadId: string): Promise<Thread> {
    const thread = await this.repository.find(threadId);
    if (!thread) throw new ThreadNotFound(threadId);
    return thread;
  }

  private async consultedDecisions(threads: readonly Thread[]): Promise<readonly Decision[]> {
    const ids = threads.flatMap(({ consultation }) => consultation?.decisionId ?? []);
    const byId = new Map(
      (await this.repository.decisionsWithIds(ids)).map((decision) => [decision.id, decision]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}
