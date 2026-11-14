import { Injectable, type OnModuleInit } from "@nestjs/common";
import { DUTIES, Duties, DutyRefused, type DutyChange } from "../../../people/index.js";
import { ProposalAppliers } from "../../application/proposal-appliers.js";
import type { DutyHolders, ProposedSettingChange } from "../../domain/proposal.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";

type DutiesChange = ProposedSettingChange<"duties">;

/**
 * Proposals of who holds the duties, which People keeps (spec §2.2, "Who holds a duty"): judged by
 * People's rules for a change of them, and applied all or none. Unlike a number, applying one is
 * refused once any duty it names holds another Role than it was drafted from.
 */
@Injectable()
export class DutyProposals implements OnModuleInit {
  constructor(
    private readonly appliers: ProposalAppliers,
    private readonly duties: Duties,
  ) {}

  onModuleInit(): void {
    this.appliers.registerSetting("duties", {
      valueNow: () => this.holdersNow(),
      problemsWith: ({ to }) => this.problemsWith(to),
      apply: (change) => this.apply(change),
    });
  }

  /** Every duty, to the Role key it names, hired or not, or null for none. */
  private async holdersNow(): Promise<DutyHolders> {
    const duties = await this.duties.list();
    return Object.fromEntries(duties.map(({ duty, roleKey }) => [duty, roleKey]));
  }

  private async problemsWith(proposed: DutyHolders): Promise<readonly string[]> {
    const changes = changesTo(proposed);
    if (changes.length === 0) return ["Name at least one duty to change."];
    const problems = await this.duties.changeProblems(changes);
    if (problems.length > 0) return problems;
    const now = await this.holdersNow();
    return changes.flatMap(({ duty, to }) =>
      now[duty as keyof DutyHolders] === to ? [heldAlready(duty, to)] : [],
    );
  }

  private async apply(change: DutiesChange): Promise<DutiesChange> {
    const changes = changesTo(change.to).map(({ duty, to }) => ({
      duty,
      from: change.from[duty as keyof DutyHolders] ?? null,
      to,
    }));
    try {
      await this.duties.changeAll(changes);
    } catch (error) {
      if (error instanceof DutyRefused) throw new ProposalRefused(error.reasons);
      throw error;
    }
    return change;
  }
}

/** The changes `holders` names, one per duty, in the order given. */
function changesTo(holders: DutyHolders): DutyChange[] {
  return Object.entries(holders).flatMap(([duty, to]) => (to === undefined ? [] : [{ duty, to }]));
}

function heldAlready(duty: string, roleKey: string | null): string {
  const label = DUTIES.find((each) => each.key === duty)?.label ?? duty;
  return roleKey === null
    ? `${label} is held by nobody already.`
    : `${label} is held by "${roleKey}" already.`;
}
