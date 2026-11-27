import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import {
  answerForUserProblems,
  answerGivenBy,
  closedDecisionRefusal,
  decisionSummary,
  hasOptions,
  isApproval,
  isOnTask,
  type Answerer,
  type Decision,
  type DecisionAnswer,
  type DecisionDraft,
} from "../domain/decision.js";
import { DecisionNotFound } from "../domain/decision-not-found.js";
import { latestWriter } from "../domain/message.js";
import type { Home, Thread } from "../domain/thread.js";
import {
  closeDecision,
  dismissDecision,
  openDecision,
  openDecisionOf,
  recordDecisionAnswer,
  SHAPING_DECISION_ON_A_TASK,
  type InitiativeThreadKind,
} from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadRunner } from "./thread-runner.js";
import { WorkRecords } from "./work-records.js";

/** A Decision waiting on the user, with the Initiative it is about when it is on no Task. */
export type DecisionWaitingOnTheUser = Decision & { readonly initiativeId?: string };

/**
 * A Decision just opened, the home of the Thread it was opened in and, on an Initiative, which of
 * its Threads that is.
 */
export interface OpenedDecision {
  readonly decision: Decision;
  readonly home: Home;
  readonly initiativeThread?: InitiativeThreadKind | undefined;
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
   * an Initiative's planning Thread on `taskId`, one of the Initiative's Tasks; in an Initiative's
   * Thread naming no Task, on the Initiative as a whole, one at a time; or in a person's chat on no
   * Task, where it waits on the user inline (spec §2.7). Refused for a session no Thread has now,
   * while the Thread waits on another on the same Task (or on no Task; in a chat, on any), for a
   * Task outside the Initiative, for any Task in the shaping Thread, and with what is asked wrong,
   * such as an Attachment that isn't the Task's, or the Initiative's on no Task.
   */
  async open(
    sessionId: string,
    draft: DecisionDraft,
    { putTo, taskId }: { readonly putTo?: string; readonly taskId?: string } = {},
  ): Promise<OpenedDecision> {
    const thread = await this.repository.findBySession(sessionId);
    if (!thread) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const initiativeThread = await this.initiativeThreadKind(thread);
    if (initiativeThread === "shaping" && taskId !== undefined) {
      throw new ThreadRefused([SHAPING_DECISION_ON_A_TASK]);
    }
    const attachmentsOfTheTask = await this.attachmentsToCheck(thread, draft, taskId);
    const id = randomUUID();
    const { thread: waiting, event } = await this.repository.update(thread.id, (latest) =>
      openDecision(latest, {
        ...draft,
        putTo,
        taskId,
        attachmentsOfTheTask,
        initiativeThread,
        id,
        askedAt: new Date(),
      }),
    );
    if (event) await this.events.publish(event);
    const decision = openDecisionOf(waiting, id);
    if (!decision) throw new Error(`Thread ${thread.id} opened no Decision.`);
    return { decision, home: waiting.home, initiativeThread };
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
   * still answering, and once it is closed. The user's dismissal closes it as answered at once, so
   * it leaves Needs you, but the person learns of it only with the user's next message in the
   * Thread; it is refused where something waits on the answer (`dismissProblems`).
   */
  async answer(id: string, answer: DecisionAnswer, answerer: Answerer): Promise<Thread> {
    const decision = await this.repository.decision(id);
    if (!decision) throw new DecisionNotFound(id);
    if (decision.answer) throw new ThreadRefused(["This Decision is answered already."]);
    if (decision.closedAt) throw new ThreadRefused([closedDecisionRefusal(decision)]);
    if (answer.kind === "dismissed") return this.dismiss(decision, answer, answerer);
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
   * The user dismisses the Decision (spec §2.4): it is answered at once, whether the person answers
   * or not, so it leaves Needs you and its Notification clears (`DecisionAnswered`), and no turn
   * starts: its line waits for the user's next message in the Thread, which carries its note
   * (`ThreadRunner.send`), or, in an Initiative's Thread, for the waiting answers' hand-over.
   * Only the user dismisses, and only where nothing waits on the answer (`dismissProblems`).
   */
  private async dismiss(
    decision: Decision,
    answer: Extract<DecisionAnswer, { kind: "dismissed" }>,
    answerer: Answerer,
  ): Promise<Thread> {
    if (answerer.kind !== "user") {
      throw new ThreadRefused(["Only the user dismisses a Decision, on its card."]);
    }
    const { thread, event } = await this.repository.update(decision.threadId, (latest) =>
      dismissDecision(latest, {
        decisionId: decision.id,
        answer,
        messageId: randomUUID(),
        answeredAt: new Date(),
        ...answerGivenBy(answerer),
      }),
    );
    if (event) await this.events.publish(event);
    return thread;
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
   * The Initiative ended, Done or Dropped (spec §2.4): every Decision on no Task still open in its
   * Threads, waiting on the user or put to a Consultant, is closed, as on a dropped Task, so it
   * leaves Needs you and can no longer be answered. Those on its Tasks stay with their Tasks.
   */
  async closeOnInitiative(initiativeId: string): Promise<void> {
    const threads = await this.repository.listIn({ kind: "initiative", initiativeId });
    for (const thread of threads) {
      for (const { id } of thread.openDecisions.filter(({ taskId }) => taskId === undefined)) {
        const { event } = await this.repository.update(thread.id, (latest) =>
          closeDecision(latest, id, new Date()),
        );
        if (event) await this.events.publish(event);
      }
    }
  }

  /**
   * The Thread is being deleted (spec §2.4.1): every Decision it still waits on is closed, so it
   * leaves Needs you and can no longer be answered. A Decision a Consultant is to answer isn't
   * closed here, as the Thread's deletion is refused while one is out.
   */
  async closeInDeletedThread(threadId: string): Promise<void> {
    const thread = await this.repository.find(threadId);
    for (const { id } of thread?.openDecisions ?? []) {
      const { event } = await this.repository.update(threadId, (latest) =>
        closeDecision(latest, id, new Date()),
      );
      if (event) await this.events.publish(event);
    }
  }

  /**
   * Every Decision waiting on the user, the first asked first: what Needs you shows. Each is on a
   * Task, or on an Initiative as a whole in one of its Threads (`initiativeId` set); a chat's
   * Decision waits on the user inline in the chat, never here (spec §2.7).
   */
  async listOpen(): Promise<readonly DecisionWaitingOnTheUser[]> {
    const [onTasks, onInitiatives] = await Promise.all([
      this.repository.openDecisions(),
      this.repository.openInInitiativeThreads(),
    ]);
    return [...onTasks.filter(isOnTask), ...onInitiatives].toSorted(
      (first, second) =>
        first.askedAt.getTime() - second.askedAt.getTime() || first.id.localeCompare(second.id),
    );
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
      readonly questions: readonly {
        readonly question: string;
        readonly options: readonly string[];
        readonly ofSeveral: boolean;
      }[];
      readonly approval: boolean;
    }[]
  > {
    const open = await this.repository.openDecisions();
    return open
      .filter((decision) => decision.taskId === taskId)
      .map((decision) => ({
        id: decision.id,
        questions: decision.questions.map((asked) => ({
          question: asked.question,
          options: hasOptions(asked) ? asked.options : [],
          ofSeveral: asked.kind === "choice-of-several",
        })),
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

  /**
   * The Decisions the Thread waits on, the first asked first, by their Task (undefined for one on
   * no Task, such as on an Initiative as a whole) and the Decision in one line.
   */
  async openInThread(
    threadId: string,
  ): Promise<readonly { readonly taskId: string | undefined; readonly question: string }[]> {
    const thread = await this.repository.find(threadId);
    return (thread?.openDecisions ?? []).map((decision) => ({
      taskId: decision.taskId,
      question: decisionSummary(decision),
    }));
  }

  /** The Thread's Decisions, open and answered, which its log's cards show. */
  listInThread(threadId: string): Promise<readonly Decision[]> {
    return this.repository.decisionsIn(threadId);
  }

  /** Which of its Initiative's Threads the Thread is, as Work tells them apart; undefined off one. */
  private async initiativeThreadKind({
    id,
    home,
  }: Thread): Promise<InitiativeThreadKind | undefined> {
    if (home.kind !== "initiative") return undefined;
    return (await this.work.isInitiativePlanningThread(home.initiativeId, id))
      ? "planning"
      : "shaping";
  }

  /**
   * The Task's Attachments, read only for a Decision that names some; in an Initiative's Thread
   * read always for one on a Task, as they tell whether the Task is the Initiative's, refused when
   * it isn't, and the Initiative's own for one on no Task that names some.
   */
  private async attachmentsToCheck(
    { home }: Thread,
    { attachmentIds = [] }: DecisionDraft,
    taskId: string | undefined,
  ): Promise<readonly string[]> {
    if (home.kind === "initiative") {
      if (taskId === undefined) {
        if (attachmentIds.length === 0) return [];
        return this.work.initiativeAttachmentIds(home.initiativeId);
      }
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
