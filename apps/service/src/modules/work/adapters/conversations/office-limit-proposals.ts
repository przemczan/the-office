import { Injectable, type OnModuleInit } from "@nestjs/common";
import { OFFICE_WIDE_LIMIT_MAX, officeWideLimitSchema } from "@the-office/contracts";
import {
  ProposalAppliers,
  ProposalRefused,
  type ProposedSettingChange,
} from "../../../conversations/index.js";
import { OfficeLimits } from "../../application/office-limits.js";

type OfficeWideLimitChange = ProposedSettingChange<"office-wide-limit">;

/**
 * Proposals of the Office-wide limit, which Work keeps: judged by the rule Settings › Office limits
 * saves it by, and applied as that page changes it. Work fills Conversations' registry itself,
 * since Work calls Conversations.
 */
@Injectable()
export class OfficeLimitProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly limits: OfficeLimits,
  ) {}

  onModuleInit(): void {
    this.appliers.registerSetting("office-wide-limit", {
      valueNow: () => this.limits.officeWideLimit(),
      problemsWith: ({ to }) => this.problemsWith(to),
      apply: (change) => this.apply(change),
    });
  }

  /** Also when the limit has the proposed value already: the Proposal holds, so it applies. */
  private async apply(change: OfficeWideLimitChange): Promise<OfficeWideLimitChange> {
    if (!isAllowed(change.to)) throw new ProposalRefused([RULE]);
    await this.limits.changeOfficeWideLimit(change.to);
    return change;
  }

  private async problemsWith(officeWideLimit: number): Promise<readonly string[]> {
    if (!isAllowed(officeWideLimit)) return [RULE];
    return officeWideLimit === (await this.limits.officeWideLimit())
      ? [`The Office-wide limit is ${officeWideLimit} already.`]
      : [];
  }
}

const RULE = `The Office-wide limit is a whole number of running Tasks from 1 to ${OFFICE_WIDE_LIMIT_MAX}.`;

function isAllowed(officeWideLimit: number): boolean {
  return officeWideLimitSchema.safeParse({ officeWideLimit }).success;
}
