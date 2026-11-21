import type { OpenProposal } from "../domain/now.js";

/** The Proposals no user has applied or declined yet, in any Thread; the composition root binds it. */
export abstract class OpenProposals {
  abstract waitingOnTheUser(): Promise<readonly OpenProposal[]>;
}
