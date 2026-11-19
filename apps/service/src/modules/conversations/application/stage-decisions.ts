import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCards } from "../../people/index.js";
import type { Recommendation } from "../domain/decision.js";
import { stageAnswerOf, type StageAnswer } from "../domain/stage-answer.js";
import { openDecision } from "../domain/thread-changes.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Consultations } from "./consultations.js";

/**
 * What a Task's Pipeline asks as The Office: one question, picked from its options, the
 * recommended one preselected.
 */
export interface StageQuestion {
  readonly question: string;
  /** What the user needs to know to decide. */
  readonly context: string;
  readonly options: readonly string[];
  readonly recommendation: Recommendation;
}

/** A Decision a Task's Pipeline puts to the user, or first to a Consultant, as The Office. */
export interface StageDecisionRequest {
  readonly taskId: string;
  /** The Stage Thread it is asked in; undefined puts it in the Task's newest Thread. */
  readonly threadId: string | undefined;
  /** Asked as a form of one choice (spec §2.3). */
  readonly draft: StageQuestion;
  /** The Consultant to put it to before the user, by the key of their Role. */
  readonly putTo?: string;
}

/** The Decision opened, and the Consultant it waits on: undefined when it waits on the user. */
export interface OpenedStageDecision {
  readonly id: string;
  readonly putTo: string | undefined;
}

/**
 * The Decisions a Task's Pipeline opens (spec §2.3), The Office's own: about limits, the
 * Definition of Done and a restart. An Agent asks its own with an Office tool. Each is a card in a
 * Thread on the Task, as every Decision is (spec §9); its answer goes back to the Pipeline through
 * DecisionAnswered. One put to a Consultant first, as a failure is to whoever holds Asked first
 * when a Stage runs out of tries, opens their
 * Consultation at once: no Agent's turn is left to end before it.
 */
@Injectable()
export class StageDecisions {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly consultations: Consultations,
    private readonly events: EventBus,
  ) {}

  /**
   * Opens the Decision, put to the Consultant asked for when one who can be consulted fills that
   * Role, otherwise to the user (spec §2.2: a missing person falls back to the user).
   */
  async open({
    taskId,
    threadId,
    draft,
    putTo,
  }: StageDecisionRequest): Promise<OpenedStageDecision> {
    const thread = await this.threadFor(taskId, threadId);
    const id = randomUUID();
    const consultant = await this.consultantFor(putTo);
    const { question, context, options, recommendation } = draft;
    const { thread: asking, event } = await this.repository.update(thread, (latest) =>
      openDecision(latest, {
        kind: "form",
        context,
        questions: [{ kind: "choice", question, options, recommendation }],
        id,
        askedAt: new Date(),
        byTheOffice: true,
        ...(consultant !== undefined && { putTo: consultant }),
      }),
    );
    if (event) await this.events.publish(event);
    if (consultant !== undefined) await this.consultations.openFor(asking);
    return { id, putTo: consultant };
  }

  /**
   * The answer to the Decision, the user's or the Consultant's, undefined while it waits. The
   * Pipeline reads it as it would wait, for an answer given before its run kept the Decision. One a
   * person gave for the user at their request is the user's own to the Pipeline.
   */
  async answerOf(id: string): Promise<StageAnswer | undefined> {
    const decision = await this.repository.decision(id);
    return decision && stageAnswerOf(decision);
  }

  private async consultantFor(roleKey: string | undefined): Promise<string | undefined> {
    if (roleKey === undefined) return undefined;
    const consultants = await this.roleCards.consultants();
    return consultants.some((consultant) => consultant.roleKey === roleKey) ? roleKey : undefined;
  }

  private async threadFor(taskId: string, threadId: string | undefined): Promise<string> {
    if (threadId) return threadId;
    const [newest] = await this.repository.listIn({ kind: "task", taskId });
    if (!newest) throw new Error(`Task ${taskId} has no Thread to ask the user in.`);
    return newest.id;
  }
}
