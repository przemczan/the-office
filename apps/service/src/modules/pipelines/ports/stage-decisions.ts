import type { StageDecision } from "../domain/stage-run.js";
import type { DecisionAnswer } from "../domain/walk-decisions.js";

/** A Decision the walk puts to the user, or first to a Consultant. */
export interface StageDecisionRequest {
  /**
   * The Decision's id, so opening it again, as the walk does after The Office stopped before
   * keeping it on its run, opens none twice; left out for a new one.
   */
  readonly id?: string;
  readonly taskId: string;
  /** The Stage Thread it is asked in; undefined puts it in the Task's newest Thread. */
  readonly threadId: string | undefined;
  readonly draft: StageDecision;
  /**
   * The Consultant it is put to before the user, by the key of their Role; it goes to the user
   * when nobody who can be consulted fills that Role.
   */
  readonly putTo?: string;
}

/** The Decision opened, and the Consultant it waits on: undefined when it waits on the user. */
export interface OpenedStageDecision {
  readonly id: string;
  readonly putTo: string | undefined;
}

/**
 * The Decisions on Tasks' conversations, which Conversations keeps; the composition root binds it.
 * Their answers come back as Conversations' DecisionAnswered.
 */
export abstract class StageDecisions {
  /** Opens the Decision; one with the request's id opened already is answered as it stands. */
  abstract open(request: StageDecisionRequest): Promise<OpenedStageDecision>;

  /**
   * The answer to the Decision, the user's or the Consultant's, undefined while it waits: for one
   * answered before a run kept it, whose DecisionAnswered found no run to take it.
   */
  abstract answerOf(decisionId: string): Promise<DecisionAnswer | undefined>;
}
