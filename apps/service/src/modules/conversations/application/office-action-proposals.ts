import { Injectable, type OnModuleInit } from "@nestjs/common";
import { OfficeToolRegistry } from "../../engine/index.js";
import { RoleCards } from "../../people/index.js";
import type { ProposedOfficeAction } from "../domain/proposal.js";
import { ProposalOutOfDate } from "../domain/proposal-out-of-date.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import type { UserRef } from "../domain/user.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Sees to Proposals of an Office action (spec 5.4.1 › Office actions): applying one runs the
 * action's own handler, through the Office tool its module registered, as the user who applies it,
 * once the fingerprint of the fields the handler reads and writes still matches the one taken at the
 * draft.
 */
@Injectable()
export class OfficeActionProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly registry: OfficeToolRegistry,
    private readonly roleCards: RoleCards,
  ) {}

  onModuleInit(): void {
    this.appliers.register("office-action", {
      problemsWith: (change) => this.problemsWith(change),
      apply: (change, proposedBy, appliedBy) => this.apply(change, proposedBy, appliedBy),
    });
  }

  private async problemsWith({ action, title, input }: ProposedOfficeAction): Promise<string[]> {
    return (await this.registry.draft(action, input))
      ? []
      : [`${title} can't be proposed: ask for it as an approval instead.`];
  }

  private async apply(
    change: ProposedOfficeAction,
    proposedBy: string,
    appliedBy: UserRef,
  ): Promise<ProposedOfficeAction> {
    const now = await this.registry.draft(change.action, change.input);
    if (now?.fingerprint !== change.fingerprint) {
      throw new ProposalOutOfDate(change.subject.title, await this.personNamed(proposedBy));
    }
    // The check and the handler aren't one transaction, so a change between them goes through; the
    // handler's own domain rules still refuse what no longer holds.
    const { text, isError } = await this.registry.applyFor(change.action, change.input, {
      user: { userId: appliedBy.userId, name: appliedBy.name },
      proposedBy,
    });
    if (isError) throw new ProposalRefused([text]);
    return change;
  }

  private async personNamed(roleKey: string): Promise<string> {
    return (await this.roleCards.find(roleKey))?.card.name ?? this.roleCards.roleTitle(roleKey);
  }
}
