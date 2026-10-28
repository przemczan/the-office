import type { Stage } from "../domain/stage.js";

/** Devops' new Stages for a library Pipeline, and its Stages now, as a Proposal carries them. */
export interface ProposedPipelineChange {
  readonly kind: "pipeline";
  readonly pipelineId: string;
  readonly from: readonly Stage[];
  readonly to: readonly Stage[];
}

/** The Proposals, which the Conversations module keeps; the composition root binds it. */
export abstract class ProposalDrafts {
  /**
   * Drafts the Proposal in the Thread whose engine session is `sessionId`, as its card there, for
   * the user to apply. Refused, with Conversations' own error, for a session no Thread has now and
   * for a change Pipelines would refuse to apply now.
   */
  abstract draft(
    sessionId: string,
    change: ProposedPipelineChange,
  ): Promise<{ readonly id: string }>;
}
