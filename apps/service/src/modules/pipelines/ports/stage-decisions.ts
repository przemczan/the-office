import type { StageDecision } from "../domain/stage-run.js";

/** A Decision the walk puts to the user. */
export interface StageDecisionRequest {
  readonly taskId: string;
  /** The Stage Thread it is asked in; undefined puts it in the Task's newest Thread. */
  readonly threadId: string | undefined;
  /** The Office asks, rather than the Agent who works in the Thread. */
  readonly byTheOffice: boolean;
  readonly draft: StageDecision;
}

/**
 * The Decisions on Tasks' conversations, which Conversations keeps; the composition root binds it.
 * Their answers come back as Conversations' DecisionAnswered.
 */
export abstract class StageDecisions {
  /** Opens the Decision and returns its id. */
  abstract open(request: StageDecisionRequest): Promise<string>;
}
