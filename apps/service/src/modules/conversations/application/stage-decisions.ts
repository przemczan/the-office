import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { DecisionAnswer, DecisionDraft } from "../domain/decision.js";
import { openDecision } from "../domain/thread-changes.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/** A Decision a Task's Pipeline puts to the user, as The Office. */
export interface StageDecisionRequest {
  readonly taskId: string;
  /** The Stage Thread it is asked in; undefined puts it in the Task's newest Thread. */
  readonly threadId: string | undefined;
  readonly draft: DecisionDraft;
}

/**
 * The Decisions a Task's Pipeline opens (spec §2.3), The Office's own: about limits, the
 * Definition of Done and a restart. An Agent asks its own with an Office tool. Each is a card in a
 * Thread on the Task, as every Decision is (spec §9); its answer goes back to the Pipeline through
 * DecisionAnswered.
 */
@Injectable()
export class StageDecisions {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly events: EventBus,
  ) {}

  /** Opens the Decision and returns its id. */
  async open({ taskId, threadId, draft }: StageDecisionRequest): Promise<string> {
    const thread = await this.threadFor(taskId, threadId);
    const id = randomUUID();
    const { event } = await this.repository.update(thread, (latest) =>
      openDecision(latest, { ...draft, id, askedAt: new Date(), byTheOffice: true }),
    );
    if (event) await this.events.publish(event);
    return id;
  }

  /**
   * The user's answer to the Decision, undefined while it waits. The Pipeline reads it as it would
   * wait, for an answer given before its run kept the Decision.
   */
  async answerOf(id: string): Promise<DecisionAnswer | undefined> {
    const answer = (await this.repository.decision(id))?.answer;
    if (!answer) return undefined;
    const { answeredAt: _answeredAt, ...given } = answer;
    return given;
  }

  private async threadFor(taskId: string, threadId: string | undefined): Promise<string> {
    if (threadId) return threadId;
    const [newest] = await this.repository.listIn({ kind: "task", taskId });
    if (!newest) throw new Error(`Task ${taskId} has no Thread to ask the user in.`);
    return newest.id;
  }
}
