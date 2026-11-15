import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import {
  answerForUserProblems,
  answerGivenBy,
  CLOSED_DECISION_REFUSAL,
  isApproval,
  isOnTask,
  type Answerer,
  type Decision,
  type DecisionAnswer,
  type DecisionDraft,
  type DecisionOnTask,
} from "../domain/decision.js";
import { DecisionNotFound } from "../domain/decision-not-found.js";
import { latestWriter } from "../domain/message.js";
import type { Home, Thread } from "../domain/thread.js";
import {
  closeDecision,
  openDecision,
  openDecisionOf,
  recordDecisionAnswer,
} from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadRunner } from "./thread-runner.js";
import { WorkRecords } from "./work-records.js";

/** A Decision just opened, and the home of the Thread it was opened in. */
export interface OpenedDecision {
  readonly decision: Decision;
  readonly home: Home;
}

/**
 * The Decisions use cases (spec §2.4): an Agent opens one in the Thread it works in on a Task, and
 * the user answers it there. Nothing waits in a tool call meanwhile: opening returns at once, and
 * the answer reaches the asking session as its next message.
 */
@Injectable()
export class DecisionService {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly runner: ThreadRunner,
    private readonly events: EventBus,
    private readonly work: WorkRecords,
    private readonly roleCards: RoleCards,
  ) {}

  /**
   * Opens a Decision in the Thread whose engine session is `sessionId`, on the Thread's Task, or in
   * an Initiative's planning Thread on `taskId`, one of the Initiative's Tasks. Refused for a
   * session no Thread has now, in a chat, while the Thread waits on another on the same Task, for a
   * Task outside the Initiative, and with what is asked wrong, such as an Attachment that isn't the
   * Task's.
   */
  async open(
    sessionId: string,
    draft: DecisionDraft,
    { putTo, taskId }: { readonly putTo?: string; readonly taskId?: string } = {},
  ): Promise<OpenedDecision> {
    const thread = await this.repository.findBySession(sessionId);
    if (!thread) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const attachmentsOfTheTask = await this.attachmentsToCheck(thread, draft, taskId);
    const id = randomUUID();
    const { thread: waiting, event } = await this.repository.update(thread.id, (latest) =>
      openDecision(latest, {
        ...draft,
        putTo,
        taskId,
        attachmentsOfTheTask,
        id,
        askedAt: new Date(),
      }),
    );
    if (event) await this.events.publish(event);
    const decision = openDecisionOf(waiting, id);
    if (!decision) throw new Error(`Thread ${thread.id} opened no Decision.`);
    return { decision, home: waiting.home };
  }

  /**
   * Answers the Decision for the user, as the person whose engine session is `sessionId`, when the
   * user asked them to in that Thread (spec §2.4): the person's word is trusted, and the answer is
   * recorded as given at the user's request, by the user who wrote the latest message in that
   * Thread, then follows every rule of `answer`; answers the Decision as answered. Refused outside a
   * Thread the user talks to them in, for a Decision put to a Consultant, an approval of a call,
   * and one in the person's own Thread (`answerForUserProblems`).
   */
  async answerForUser(sessionId: string, id: string, answer: DecisionAnswer): Promise<Decision> {
    const caller = await this.repository.findBySession(sessionId);
    if (!caller) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const decision = await this.repository.decision(id);
    if (!decision) throw new DecisionNotFound(id);
    const problems = answerForUserProblems(decision, caller);
    if (problems.length > 0) throw new ThreadRefused(problems);
    const person = await this.roleCards.find(caller.roleKey);
    const user = latestWriter(await this.repository.messages(caller.id)) ?? null;
    await this.answer(id, answer, {
      kind: "at-users-request",
      roleKey: caller.roleKey,
      threadId: caller.id,
      user,
      name: person?.card.name ?? caller.roleKey,
    });
    return (await this.repository.decision(id)) ?? decision;
  }

  /**
   * Answers the Decision as `answerer`: a user, any signed-in one, as Decisions are shared; the
   * Consultant it was put to, a person the user asked to answer it for them, or The Office. The
   * person who asked takes the answer in its Thread as their next message.
   * The answer to The Office's Decision, or to one in a Stage Thread, goes to the Task's Pipeline
   * instead, which runs on from it, even when given while the asking Stage still runs: the
   * Pipeline reads it as the Stage ends. Refused once it is answered, and while the person is
   * still answering, and once it is closed.
   */
  async answer(id: string, answer: DecisionAnswer, answerer: Answerer): Promise<Thread> {
    const decision = await this.repository.decision(id);
    if (!decision) throw new DecisionNotFound(id);
    if (decision.answer) throw new ThreadRefused(["This Decision is answered already."]);
    if (decision.closedAt) throw new ThreadRefused([CLOSED_DECISION_REFUSAL]);
    const thread = await this.repository.find(decision.threadId);
    if (!thread) throw new Error(`Decision ${id}'s Thread is gone.`);
    if (decision.roleKey !== undefined && !thread.stageThread) {
      return this.runner.answerDecision(decision.threadId, id, answer, answerer);
    }
    const { thread: answered, event } = await this.repository.update(thread.id, (latest) =>
      recordDecisionAnswer(latest, {
        decisionId: id,
        answer,
        messageId: randomUUID(),
        answeredAt: new Date(),
        ...answerGivenBy(answerer),
      }),
    );
    if (event) await this.events.publish(event);
    return answered;
  }

  /**
   * The Task was dropped (spec §2.4): every Decision still open on it, waiting on the user or put
   * to a Consultant, in any of its Threads, is closed, so it leaves Needs you and can no longer be
   * answered. A Consultation's session isn't stopped here: the Task's Drop stops its work.
   */
  async closeOnDroppedTask(taskId: string): Promise<void> {
    const open = await this.repository.unansweredOn(taskId);
    for (const { id, threadId } of open) {
      const { event } = await this.repository.update(threadId, (latest) =>
        closeDecision(latest, id, new Date()),
      );
      if (event) await this.events.publish(event);
    }
  }

  /**
   * Every Decision waiting on the user, the first asked first: what Waiting on you shows. Each is on
   * a Task, as a call made from a chat never waits on the user (spec §2.4).
   */
  async listOpen(): Promise<readonly DecisionOnTask[]> {
    return (await this.repository.openDecisions()).filter(isOnTask);
  }

  /**
   * Every Decision on the Task nobody has answered, in any of its Threads, the first asked first:
   * those waiting on the user, and those put to a Consultant, which the user may take over.
   */
  listUnansweredOn(taskId: string): Promise<readonly Decision[]> {
    return this.repository.unansweredOn(taskId);
  }

  /**
   * The Decisions on the Task waiting on the user, in any of its Threads, the first asked first: as
   * the Task's record lists them, for a person to answer one for the user when they ask.
   */
  async waitingOnTheUserOn(taskId: string): Promise<
    readonly {
      readonly id: string;
      readonly question: string;
      readonly options: readonly string[];
      readonly approval: boolean;
    }[]
  > {
    const open = await this.repository.openDecisions();
    return open
      .filter((decision) => decision.taskId === taskId)
      .map((decision) => ({
        id: decision.id,
        question: decision.question,
        options: decision.options,
        approval: isApproval(decision),
      }));
  }

  /** The ids of the Tasks a Decision waiting on the user is open on, each once. */
  async tasksWithOpenDecisions(): Promise<readonly string[]> {
    const open = await this.repository.openDecisions();
    return [...new Set(open.filter(isOnTask).map(({ taskId }) => taskId))];
  }

  /** How many Decisions on the Task wait on the user, in any of its Threads. */
  async openOn(taskId: string): Promise<number> {
    const open = await this.repository.openDecisions();
    return open.filter((decision) => decision.taskId === taskId).length;
  }

  /** The Decisions on Tasks the Thread waits on, the first asked first, by their Task and question. */
  async openInThread(
    threadId: string,
  ): Promise<readonly { readonly taskId: string; readonly question: string }[]> {
    const thread = await this.repository.find(threadId);
    return (thread?.openDecisions ?? [])
      .filter(isOnTask)
      .map(({ taskId, question }) => ({ taskId, question }));
  }

  /** The Thread's Decisions, open and answered, which its log's cards show. */
  listInThread(threadId: string): Promise<readonly Decision[]> {
    return this.repository.decisionsIn(threadId);
  }

  /**
   * The Task's Attachments, read only for a Decision that names some; in an Initiative's Thread
   * read always, as they tell whether the Task is the Initiative's, refused when it isn't.
   */
  private async attachmentsToCheck(
    { home }: Thread,
    { attachmentIds = [] }: DecisionDraft,
    taskId: string | undefined,
  ): Promise<readonly string[]> {
    if (home.kind === "initiative" && taskId !== undefined) {
      const ids = await this.work.initiativeTaskAttachmentIds(home.initiativeId, taskId);
      if (!ids) {
        throw new ThreadRefused([
          `The Task ${taskId} isn't one of this Initiative's Tasks: open the Decision on one of them.`,
        ]);
      }
      return ids;
    }
    if (home.kind !== "task" || attachmentIds.length === 0) return [];
    return this.work.taskAttachmentIds(home.taskId);
  }
}
