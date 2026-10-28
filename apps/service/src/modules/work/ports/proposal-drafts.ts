import type { NewProject } from "../../projects/index.js";
import type { InitiativeEdit } from "../domain/initiative-edit.js";

/** A change the CTO wants to an active Initiative, as a Proposal carries it. */
export interface ProposedInitiativeChange {
  readonly kind: "initiative";
  readonly initiativeId: string;
  readonly edit: InitiativeEdit;
}

/** A Project Devops drafted to onboard, as a Proposal carries it before the user applied it. */
export interface ProposedProject {
  readonly kind: "project";
  readonly project: NewProject;
  readonly projectId: undefined;
  readonly taskId: undefined;
}

/** The changes Work drafts as Proposals. */
export type WorkProposedChange = ProposedInitiativeChange | ProposedProject;

/** The Proposals, which the Conversations module keeps; the composition root binds it. */
export abstract class ProposalDrafts {
  /**
   * Drafts the Proposal in the Thread whose engine session is `sessionId`, as its card there, for
   * the user to apply. Refused, with Conversations' own error, for a session no Thread has now and
   * for a change its owner would refuse to apply now.
   */
  abstract draft(sessionId: string, change: WorkProposedChange): Promise<{ readonly id: string }>;
}
