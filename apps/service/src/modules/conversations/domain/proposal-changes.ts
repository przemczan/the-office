import { ProposalApplied, ProposalDeclined } from "./conversation-events.js";
import {
  refuseUnlessOpen,
  type Proposal,
  type ProposalDeclinedBecause,
  type ProposedChange,
} from "./proposal.js";
import type { Thread } from "./thread.js";
import type { UserRef } from "./user.js";

/** A Proposal after a change, with the event that announces it. */
export interface ProposalChange<Event> {
  readonly proposal: Proposal;
  readonly event: Event;
}

/** The user `by` applied the Proposal, which its owner carried out as `applied`. */
export function applyProposal(
  proposal: Proposal,
  thread: Thread,
  applied: ProposedChange,
  appliedAt: Date,
  by: UserRef,
): ProposalChange<ProposalApplied> {
  refuseUnlessOpen(proposal);
  if (applied.kind !== proposal.change.kind) {
    throw new Error(`Proposal ${proposal.id} was applied as a change of another kind.`);
  }
  const changed: Proposal = {
    ...proposal,
    change: applied,
    status: { kind: "applied", at: appliedAt, by },
  };
  return { proposal: changed, event: new ProposalApplied(thread, changed, appliedAt) };
}

/**
 * The user `by` declined the Proposal ("Not now"): nothing changes, and it can't be applied later.
 */
export function declineProposal(
  proposal: Proposal,
  thread: Thread,
  declinedAt: Date,
  by: UserRef,
): ProposalChange<ProposalDeclined> {
  refuseUnlessOpen(proposal);
  const changed: Proposal = { ...proposal, status: { kind: "declined", at: declinedAt, by } };
  return { proposal: changed, event: new ProposalDeclined(thread, changed, declinedAt) };
}

/** The Office declined the Proposal on its own, `because` says why; it names no user. */
export function declineProposalOnItsOwn(
  proposal: Proposal,
  thread: Thread,
  declinedAt: Date,
  because: ProposalDeclinedBecause,
): ProposalChange<ProposalDeclined> {
  refuseUnlessOpen(proposal);
  const changed: Proposal = {
    ...proposal,
    status: { kind: "declined", at: declinedAt, by: null, because },
  };
  return { proposal: changed, event: new ProposalDeclined(thread, changed, declinedAt) };
}
