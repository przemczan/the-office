import { ProposalRefused } from "./proposal-refused.js";

/**
 * A Proposal of an Office action whose subject changed since it was drafted (spec 2.4.2 › Proposals
 * and approvals): its fingerprint no longer matches, so applying it is refused and its card reads
 * Out of date.
 */
export class ProposalOutOfDate extends ProposalRefused {
  constructor(subjectTitle: string, drafter: string) {
    super([`"${subjectTitle}" changed since ${drafter} drafted this. Ask them to draft it again.`]);
    this.name = "ProposalOutOfDate";
  }
}
