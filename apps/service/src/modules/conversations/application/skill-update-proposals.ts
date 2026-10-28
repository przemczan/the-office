import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SkillRefused, SkillUpdates } from "../../skills/index.js";
import type { ProposedSkillUpdate } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals to update an installed skill (spec §2.6), which Skills carries out: applying is the
 * user's review of the update, and The Office fetches the files itself, since chats only read
 * (spec §6). Conversations registers them, since Conversations calls Skills.
 */
@Injectable()
export class SkillUpdateProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly updates: SkillUpdates,
  ) {}

  onModuleInit(): void {
    this.appliers.register("skill-update", {
      problemsWith: (change) => this.updates.problems(change),
      apply: (change) => this.apply(change),
    });
  }

  private async apply(change: ProposedSkillUpdate): Promise<ProposedSkillUpdate> {
    try {
      await this.updates.apply(change);
      return change;
    } catch (error) {
      if (error instanceof SkillRefused) throw new ProposalRefused(error.reasons);
      throw error;
    }
  }
}
