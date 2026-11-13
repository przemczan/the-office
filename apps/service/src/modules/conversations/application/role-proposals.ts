import { Injectable, type OnModuleInit } from "@nestjs/common";
import { RoleNotFound, RoleRefused, RoleService } from "../../people/index.js";
import type { ProposedHire, ProposedPresetHire, ProposedRoleChange } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import type { UserRef } from "../domain/user.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals of Roles, which People applies: a new Role is hired from scratch or from a preset, and
 * a change rewrites the fields it names on the card as it is when applied, keeping the Role's
 * skills. People's hiring and card rules judge each, so a refused one changes nothing and gives
 * People's reasons. Each is saved by the user who applied it, as proposed by its drafter.
 */
@Injectable()
export class RoleProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly roles: RoleService,
  ) {}

  onModuleInit(): void {
    this.appliers.register("hire", {
      problemsWith: ({ card, skills }) => this.roles.hiringProblems(card, skills),
      apply: (hire, proposedBy, appliedBy) => this.hire(hire, proposedBy, appliedBy),
    });
    this.appliers.register("hire-from-preset", {
      problemsWith: ({ roleKey, name }) => this.roles.presetHiringProblems(roleKey, name),
      apply: (hire, proposedBy, appliedBy) => this.hireFromPreset(hire, proposedBy, appliedBy),
    });
    this.appliers.register("change", {
      problemsWith: (change) => this.changeProblems(change),
      apply: (change, proposedBy, appliedBy) => this.change(change, proposedBy, appliedBy),
    });
  }

  private async hire(
    hire: ProposedHire,
    proposedBy: string,
    appliedBy: UserRef,
  ): Promise<ProposedHire> {
    const { role } = await refusedAsProposal(() =>
      this.roles.hireFromScratch(hire.card, hire.skills, appliedBy, proposedBy),
    );
    return { ...hire, roleKey: role.key };
  }

  private async hireFromPreset(
    hire: ProposedPresetHire,
    proposedBy: string,
    appliedBy: UserRef,
  ): Promise<ProposedPresetHire> {
    const { role } = await refusedAsProposal(() =>
      this.roles.hire(hire.roleKey, hire.name, appliedBy, proposedBy),
    );
    return { ...hire, name: role.card.name };
  }

  private async changeProblems({ roleKey, to }: ProposedRoleChange): Promise<readonly string[]> {
    try {
      const { role } = await this.roles.read(roleKey);
      return await this.roles.cardChangeProblems(roleKey, { ...role.card, ...to });
    } catch (error) {
      if (error instanceof RoleNotFound) return [noSuchRole(roleKey)];
      throw error;
    }
  }

  /** A card that reads as proposed already is left as it is: the Proposal holds, so it applies. */
  private async change(
    change: ProposedRoleChange,
    proposedBy: string,
    appliedBy: UserRef,
  ): Promise<ProposedRoleChange> {
    await refusedAsProposal(async () => {
      const { role, skills } = await this.roles.read(change.roleKey);
      return this.roles.changeCard(
        change.roleKey,
        { ...role.card, ...change.to },
        skills,
        appliedBy,
        proposedBy,
      );
    });
    return change;
  }
}

/** Runs People's command, giving its refusal, or a Role that isn't there, as the Proposal's. */
async function refusedAsProposal<Result>(command: () => Promise<Result>): Promise<Result> {
  try {
    return await command();
  } catch (error) {
    if (error instanceof RoleRefused) throw new ProposalRefused(error.reasons);
    if (error instanceof RoleNotFound) throw new ProposalRefused([noSuchRole(error.roleKey)]);
    throw error;
  }
}

function noSuchRole(roleKey: string): string {
  return `The Office has no Role "${roleKey}".`;
}
