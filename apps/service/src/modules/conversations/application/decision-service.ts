import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Decision, DecisionAnswer, DecisionDraft } from "../domain/decision.js";
import { DecisionNotFound } from "../domain/decision-not-found.js";
import type { Home, Thread } from "../domain/thread.js";
import { openDecision, openDecisionOf, recordDecisionAnswer } from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadRunner, type Answerer } from "./thread-runner.js";
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
   * Answers the Decision, as the user or as `answerer`, the Consultant it was put to; the person who
   * asked takes the answer in its Thread as their next message.
   * The answer to The Office's Decision, or to one in a Stage Thread, goes to the Task's Pipeline
   * instead, which runs on from it, even when given while the asking Stage still runs: the
   * Pipeline reads it as the Stage ends. Refused once it is answered, and while the person is
   * still answering.
   */
  async answer(id: string, answer: DecisionAnswer, answerer?: Answerer): Promise<Thread> {
    const decision = await this.repository.decision(id);
    if (!decision) throw new DecisionNotFound(id);
    if (decision.answer) throw new ThreadRefused(["This Decision is answered already."]);
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
        answeredBy: answerer?.roleKey,
      }),
    );
    if (event) await this.events.publish(event);
    return answered;
  }

  /** Every Decision waiting on the user, the first asked first: what Waiting on you shows. */
  listOpen(): Promise<readonly Decision[]> {
    return this.repository.openDecisions();
  }

  /**
   * Every Decision on the Task nobody has answered, in any of its Threads, the first asked first:
   * those waiting on the user, and those put to a Consultant, which the user may take over.
   */
  listUnansweredOn(taskId: string): Promise<readonly Decision[]> {
    return this.repository.unansweredOn(taskId);
  }

  /** How many Decisions on the Task wait on the user, in any of its Threads. */
  async openOn(taskId: string): Promise<number> {
    const open = await this.repository.openDecisions();
    return open.filter((decision) => decision.taskId === taskId).length;
  }

  /** The Decisions the Thread waits on, the first asked first, by their Task and question. */
  async openInThread(
    threadId: string,
  ): Promise<readonly { readonly taskId: string; readonly question: string }[]> {
    const thread = await this.repository.find(threadId);
    return (thread?.openDecisions ?? []).map(({ taskId, question }) => ({ taskId, question }));
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
