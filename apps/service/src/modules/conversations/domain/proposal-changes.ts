import { ProposalApplied, ProposalDeclined } from "./conversation-events.js";
import { refuseUnlessOpen, type Proposal, type ProposedChange } from "./proposal.js";
import type { Thread } from "./thread.js";

/** A Proposal after a change, with the event that announces it. */
export interface ProposalChange<Event> {
  readonly proposal: Proposal;
  readonly event: Event;
}

/** The user applied the Proposal, which its owner carried out as `applied`. */
export function applyProposal(
  proposal: Proposal,
  thread: Thread,
  applied: ProposedChange,
  appliedAt: Date,
): ProposalChange<ProposalApplied> {
  refuseUnlessOpen(proposal);
  if (applied.kind !== proposal.change.kind) {
    throw new Error(`Proposal ${proposal.id} was applied as a change of another kind.`);
  }
  const changed: Proposal = {
    ...proposal,
    change: applied,
    status: { kind: "applied", at: appliedAt },
  };
  return { proposal: changed, event: new ProposalApplied(thread, changed, appliedAt) };
}

/** The user declined the Proposal ("Not now"): nothing changes, and it can't be applied later. */
export function declineProposal(
  proposal: Proposal,
  thread: Thread,
  declinedAt: Date,
): ProposalChange<ProposalDeclined> {
  refuseUnlessOpen(proposal);
  const changed: Proposal = { ...proposal, status: { kind: "declined", at: declinedAt } };
  return { proposal: changed, event: new ProposalDeclined(thread, changed, declinedAt) };
}
