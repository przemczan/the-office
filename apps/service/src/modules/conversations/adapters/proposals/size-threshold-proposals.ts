import { Injectable, type OnModuleInit } from "@nestjs/common";
import { SIZE_THRESHOLD_TOKENS, sizeThresholdSchema } from "@the-office/contracts";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import type { ProposedSettingChange } from "../../domain/proposal.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";

/**
 * Proposals of the Context policy's size threshold, which Conversations keeps: judged by the rule
 * Settings › Office limits saves it by, and applied as that page changes it.
 */
@Injectable()
export class SizeThresholdProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly settings: ContextPolicySettingsService,
  ) {}

  onModuleInit(): void {
    this.appliers.registerSetting("size-threshold", {
      valueNow: () => this.settings.sizeThreshold(),
      problemsWith: ({ to }) => this.problemsWith(to),
      apply: (change) => this.apply(change),
    });
  }

  private async problemsWith(sizeThreshold: number): Promise<readonly string[]> {
    if (!isAllowed(sizeThreshold)) return [RULE];
    return sizeThreshold === (await this.settings.sizeThreshold())
      ? [`The size threshold is ${sizeThreshold} tokens already.`]
      : [];
  }

  /** Also when the threshold has the proposed value already: the Proposal holds, so it applies. */
  private async apply(
    change: ProposedSettingChange<"size-threshold">,
  ): Promise<ProposedSettingChange<"size-threshold">> {
    if (!isAllowed(change.to)) throw new ProposalRefused([RULE]);
    await this.settings.changeSizeThreshold(change.to);
    return change;
  }
}

const RULE = `The size threshold is from ${SIZE_THRESHOLD_TOKENS.min} to ${SIZE_THRESHOLD_TOKENS.max} tokens, in steps of ${SIZE_THRESHOLD_TOKENS.step}.`;

function isAllowed(sizeThreshold: number): boolean {
  return sizeThresholdSchema.safeParse({ sizeThreshold }).success;
}
