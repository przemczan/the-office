/**
 * A Proposal that can't be drafted or applied, or a change of one that breaks the rules, with every
 * reason, in the words of the person or the user who acts on it.
 */
export class ProposalRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "ProposalRefused";
  }
}
