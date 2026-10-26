import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Decision, DecisionAnswer, DecisionDraft } from "../domain/decision.js";
import { DecisionNotFound } from "../domain/decision-not-found.js";
import type { Thread } from "../domain/thread.js";
import { openDecision, recordDecisionAnswer } from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadRunner } from "./thread-runner.js";

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
  ) {}

  /**
   * Opens a Decision in the Thread whose engine session is `sessionId`. Refused for a session no
   * Thread has now, in a chat, while the Thread waits on another, and with what is asked wrong.
   */
  async open(sessionId: string, draft: DecisionDraft): Promise<Decision> {
    const thread = await this.repository.findBySession(sessionId);
    if (!thread) throw new ThreadRefused(["The Office doesn't know this session's Thread."]);
    const { thread: waiting, event } = await this.repository.update(thread.id, (latest) =>
      openDecision(latest, { ...draft, id: randomUUID(), askedAt: new Date() }),
    );
    if (event) await this.events.publish(event);
    if (!waiting.openDecision) throw new Error(`Thread ${thread.id} opened no Decision.`);
    return waiting.openDecision;
  }

  /**
   * Answers the Decision; the person who asked takes the answer in its Thread as their next message.
   * The answer to The Office's Decision, or to one in a Stage Thread, goes to the Task's Pipeline
   * instead, which runs on from it. Refused once it is answered, and while the person is still
   * answering.
   */
  async answer(id: string, answer: DecisionAnswer): Promise<Thread> {
    const decision = await this.repository.decision(id);
    if (!decision) throw new DecisionNotFound(id);
    if (decision.answer) throw new ThreadRefused(["This Decision is answered already."]);
    const thread = await this.repository.find(decision.threadId);
    if (!thread) throw new Error(`Decision ${id}'s Thread is gone.`);
    if (decision.roleKey !== undefined && !thread.stageThread) {
      return this.runner.answerDecision(decision.threadId, id, answer);
    }
    const { thread: answered, event } = await this.repository.update(thread.id, (latest) =>
      recordDecisionAnswer(latest, {
        decisionId: id,
        answer,
        messageId: randomUUID(),
        answeredAt: new Date(),
      }),
    );
    if (event) await this.events.publish(event);
    return answered;
  }

  /** Every Decision waiting on the user, the first asked first: what Waiting on you shows. */
  listOpen(): Promise<readonly Decision[]> {
    return this.repository.openDecisions();
  }

  /** The Thread's Decisions, open and answered, which its log's cards show. */
  listInThread(threadId: string): Promise<readonly Decision[]> {
    return this.repository.decisionsIn(threadId);
  }
}
