import { Injectable } from "@nestjs/common";
import type { ProposedChange, ProposedChangeKind, ProposedChanges } from "../domain/proposal.js";

/**
 * How the module that owns a kind of change sees to Proposals of it: what is wrong with one as it
 * is drafted, and carrying it out when the user applies it.
 */
export interface ProposalApplier<Kind extends ProposedChangeKind> {
  /** Every reason applying the change would be refused now, in words the drafter acts on. */
  problemsWith(change: ProposedChanges[Kind]): Promise<readonly string[]>;
  /**
   * Carries the change out for the user, as proposed by the person `proposedBy` (their Role's
   * key), and answers it as applied. Throws ProposalRefused, changing nothing, when it can't.
   */
  apply(change: ProposedChanges[Kind], proposedBy: string): Promise<ProposedChanges[Kind]>;
}

type Appliers = { [Kind in ProposedChangeKind]?: ProposalApplier<Kind> };

/**
 * Who applies each kind of Proposal: the module that owns what it changes registers as it starts,
 * as modules give the Engine their Office tools. Conversations calls People itself; a module that
 * calls Conversations, such as Work, fills its kinds in here instead (module template).
 */
@Injectable()
export class ProposalAppliers {
  private readonly appliers: Appliers = {};

  register<Kind extends ProposedChangeKind>(kind: Kind, applier: ProposalApplier<Kind>): void {
    if (this.appliers[kind]) throw new Error(`Proposals of "${kind}" have an applier already.`);
    // TypeScript writes to an entry keyed by a generic kind as if it were every kind at once.
    this.appliers[kind] = applier as Appliers[Kind];
  }

  problemsWith(change: ProposedChange): Promise<readonly string[]> {
    switch (change.kind) {
      case "hire":
        return this.applierOf("hire").problemsWith(change);
      case "change":
        return this.applierOf("change").problemsWith(change);
    }
  }

  apply(change: ProposedChange, proposedBy: string): Promise<ProposedChange> {
    switch (change.kind) {
      case "hire":
        return this.applierOf("hire").apply(change, proposedBy);
      case "change":
        return this.applierOf("change").apply(change, proposedBy);
    }
  }

  private applierOf<Kind extends ProposedChangeKind>(kind: Kind): ProposalApplier<Kind> {
    const applier = this.appliers[kind];
    if (!applier) throw new Error(`Nothing applies Proposals of "${kind}".`);
    return applier;
  }
}
