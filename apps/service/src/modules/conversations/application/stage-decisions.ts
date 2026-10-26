import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { DecisionDraft } from "../domain/decision.js";
import { openDecision } from "../domain/thread-changes.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/** A Decision a Task's Pipeline puts to the user. */
export interface StageDecisionRequest {
  readonly taskId: string;
  /** The Stage Thread it is asked in; undefined puts it in the Task's newest Thread. */
  readonly threadId: string | undefined;
  /** The Office asks, rather than the Thread's person. */
  readonly byTheOffice: boolean;
  readonly draft: DecisionDraft;
}

/**
 * The Decisions a Task's Pipeline opens (spec §2.3): an Agent Stage's question, once its session
 * has ended, and The Office's own about limits and the Definition of Done. Each is a card in a
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
  async open({ taskId, threadId, byTheOffice, draft }: StageDecisionRequest): Promise<string> {
    const thread = await this.threadFor(taskId, threadId);
    const id = randomUUID();
    const { event } = await this.repository.update(thread, (latest) =>
      openDecision(latest, { ...draft, id, askedAt: new Date(), byTheOffice }),
    );
    if (event) await this.events.publish(event);
    return id;
  }

  private async threadFor(taskId: string, threadId: string | undefined): Promise<string> {
    if (threadId) return threadId;
    const [newest] = await this.repository.listIn({ kind: "task", taskId });
    if (!newest) throw new Error(`Task ${taskId} has no Thread to ask the user in.`);
    return newest.id;
  }
}
