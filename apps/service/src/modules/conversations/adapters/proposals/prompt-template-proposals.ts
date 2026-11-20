import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  PromptTemplateNotFound,
  PromptTemplateRefused,
  PromptTemplates,
  refusalOf,
  type PromptTemplateState,
} from "../../../prompt-templates/index.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import type { ProposedPromptTemplateChange } from "../../domain/proposal.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import type { UserRef } from "../../domain/user.js";

/**
 * Proposals of a prompt template's text, which Prompt templates keeps (spec §2.2): judged by the
 * check Settings › Prompts saves a text by, in its words, both when drafted and when applied.
 * Applying one is refused once the template's text differs from the one it was drafted from, as a
 * Proposal replaces the text whole.
 */
@Injectable()
export class PromptTemplateProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly templates: PromptTemplates,
  ) {}

  onModuleInit(): void {
    this.appliers.register("prompt-template", {
      problemsWith: (change) => this.problemsWith(change),
      apply: (change, _proposedBy, appliedBy) => this.apply(change, appliedBy),
    });
  }

  private async problemsWith({
    key,
    to,
  }: ProposedPromptTemplateChange): Promise<readonly string[]> {
    const state = await this.stateOf(key);
    if (typeof state === "string") return [state];
    if (to === null) {
      return state.customised ? [] : ["The template is its default already."];
    }
    const problems = this.templates.check(key, to);
    if (problems.length > 0) return refusalOf(problems).reasons;
    return to === state.text ? ["The template is this text already."] : [];
  }

  private async apply(
    change: ProposedPromptTemplateChange,
    appliedBy: UserRef,
  ): Promise<ProposedPromptTemplateChange> {
    const state = await this.stateOf(change.key);
    if (typeof state === "string") throw new ProposalRefused([state]);
    try {
      await this.templates.replace(
        change.key,
        change.from,
        change.to ?? state.template.text,
        appliedBy,
      );
    } catch (error) {
      if (error instanceof PromptTemplateRefused) throw new ProposalRefused(error.reasons);
      throw error;
    }
    return change;
  }

  /** The template as it stands, or why there is none, in words the drafter acts on. */
  private async stateOf(key: string): Promise<PromptTemplateState | string> {
    try {
      return await this.templates.read(key);
    } catch (error) {
      if (error instanceof PromptTemplateNotFound) return error.message;
      throw error;
    }
  }
}
