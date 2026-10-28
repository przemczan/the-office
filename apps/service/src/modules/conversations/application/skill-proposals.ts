import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SkillLibrary, SkillRefused } from "../../skills/index.js";
import type { ProposedSkill } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals of a written skill (spec §2.6), which Skills adds as the Write form does: off until the
 * user has reviewed it. Conversations registers them, since Conversations calls Skills.
 */
@Injectable()
export class SkillProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly library: SkillLibrary,
  ) {}

  onModuleInit(): void {
    this.appliers.register("skill", {
      problemsWith: (change) => this.library.writeProblems(change),
      apply: (change) => this.apply(change),
    });
  }

  private async apply(change: ProposedSkill): Promise<ProposedSkill> {
    try {
      await this.library.write(change);
      return change;
    } catch (error) {
      if (error instanceof SkillRefused) throw new ProposalRefused(error.reasons);
      throw error;
    }
  }
}
