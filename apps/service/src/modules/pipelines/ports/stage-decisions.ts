import type { StageDecision } from "../domain/stage-run.js";
import type { DecisionAnswer } from "../domain/walk-decisions.js";

/** A Decision the walk puts to the user. */
export interface StageDecisionRequest {
  readonly taskId: string;
  /** The Stage Thread it is asked in; undefined puts it in the Task's newest Thread. */
  readonly threadId: string | undefined;
  readonly draft: StageDecision;
}

/**
 * The Decisions on Tasks' conversations, which Conversations keeps; the composition root binds it.
 * Their answers come back as Conversations' DecisionAnswered.
 */
export abstract class StageDecisions {
  /** Opens the Decision and returns its id. */
  abstract open(request: StageDecisionRequest): Promise<string>;

  /**
   * The user's answer to the Decision, undefined while it waits: for one answered before a run
   * kept it, whose DecisionAnswered found no run to take it.
   */
  abstract answerOf(decisionId: string): Promise<DecisionAnswer | undefined>;
}
