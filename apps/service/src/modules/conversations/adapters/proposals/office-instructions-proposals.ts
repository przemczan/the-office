import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  OFFICE_INSTRUCTIONS_MAX_CHARACTERS,
  officeInstructionsSchema,
} from "@the-office/contracts";
import { OfficeInstructions } from "../../application/office-instructions.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import type { ProposedSettingChange } from "../../domain/proposal.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import type { UserRef } from "../../domain/user.js";

type OfficeInstructionsChange = ProposedSettingChange<"office-instructions">;

/**
 * Proposals of the Office instructions, which Conversations keeps: judged by the rule Settings ›
 * Office instructions saves them by. Unlike a number, applying one is refused once the text differs
 * from the one it was drafted from, as a Proposal replaces the text whole.
 */
@Injectable()
export class OfficeInstructionsProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly instructions: OfficeInstructions,
  ) {}

  onModuleInit(): void {
    this.appliers.registerSetting("office-instructions", {
      valueNow: () => this.textNow(),
      problemsWith: ({ to }) => this.problemsWith(to),
      apply: (change, _proposedBy, appliedBy) => this.apply(change, appliedBy),
    });
  }

  private async textNow(): Promise<string> {
    const { text } = await this.instructions.current();
    return text;
  }

  private async problemsWith(proposed: string): Promise<readonly string[]> {
    const text = allowedText(proposed);
    if (text === undefined) return [RULE];
    return text === (await this.textNow())
      ? ["The Office instructions are this text already."]
      : [];
  }

  private async apply(
    change: OfficeInstructionsChange,
    appliedBy: UserRef,
  ): Promise<OfficeInstructionsChange> {
    const text = allowedText(change.to);
    if (text === undefined) throw new ProposalRefused([RULE]);
    await this.instructions.replace(change.from, text, appliedBy);
    return { ...change, to: text };
  }
}

const RULE = `The Office instructions are at most ${OFFICE_INSTRUCTIONS_MAX_CHARACTERS} characters.`;

/** The text as Settings would save it; undefined when Settings would refuse it. */
function allowedText(officeInstructions: string): string | undefined {
  return officeInstructionsSchema.safeParse({ officeInstructions }).data?.officeInstructions;
}
