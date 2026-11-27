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
      apply: (change, proposedBy, appliedBy, proposalId) =>
        this.apply(change, proposedBy, appliedBy, proposalId),
      withoutSecrets: (change) => this.withoutSecrets(change),
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
    proposalId: string | undefined,
  ): Promise<ProposedOfficeAction> {
    // Out of date is judged on the call as drafted, the edited card being the user's own.
    const now = await this.registry.draft(change.action, change.input);
    if (now?.fingerprint !== change.fingerprint) {
      throw new ProposalOutOfDate(change.subject.title, await this.personNamed(proposedBy));
    }
    // The check and the handler aren't one transaction, so a change between them goes through; the
    // handler's own domain rules still refuse what no longer holds.
    const { text, isError } = await this.registry.applyFor(
      change.action,
      change.editedInput ?? change.input,
      {
        user: { userId: appliedBy.userId, name: appliedBy.name },
        proposedBy,
        ...(proposalId !== undefined && { proposalId }),
      },
    );
    if (isError) throw new ProposalRefused([text]);
    return change;
  }

  /** The call as drafted and as edited, each with its Secret values emptied: none stays readable. */
  private async withoutSecrets(change: ProposedOfficeAction): Promise<ProposedOfficeAction> {
    const { shown, hasSecret } = await this.registry.redact(change.action, change.input);
    const edited =
      change.editedInput && (await this.registry.redact(change.action, change.editedInput));
    if (!hasSecret && !edited?.hasSecret) return change;
    return { ...change, input: shown, ...(edited && { editedInput: edited.shown }) };
  }

  private async personNamed(roleKey: string): Promise<string> {
    return (await this.roleCards.find(roleKey))?.card.name ?? this.roleCards.roleTitle(roleKey);
  }
}
