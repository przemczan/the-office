import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SkillLibrary, SkillRefused } from "../../skills/index.js";
import type { ProposedSkillInstall } from "../domain/proposal.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ProposalAppliers } from "./proposal-appliers.js";

/**
 * Proposals to install a skill from a Source (spec §2.6), which Skills carries out: applying is the
 * user's confirmation, and The Office fetches the skill itself, since chats only read (spec §6).
 * Conversations registers them, since Conversations calls Skills.
 */
@Injectable()
export class SkillInstallProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly library: SkillLibrary,
  ) {}

  onModuleInit(): void {
    this.appliers.register("skill-install", {
      problemsWith: ({ name }) => this.library.installProblems(name),
      apply: (change) => this.apply(change),
    });
  }

  private async apply(change: ProposedSkillInstall): Promise<ProposedSkillInstall> {
    try {
      await this.library.install({
        repository: change.repository,
        folder: change.folder,
        pinnedVersion: change.pinnedVersion,
        filesHash: change.filesHash,
      });
      return change;
    } catch (error) {
      if (error instanceof SkillRefused) throw new ProposalRefused(error.reasons);
      throw error;
    }
  }
}
