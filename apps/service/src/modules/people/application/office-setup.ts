import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineReferenceLock } from "../../engine/index.js";
import { RoleSkills } from "../../skills/index.js";
import { DutyHolderChanged } from "../domain/duty-events.js";
import {
  hiredKeyOf,
  hireWords,
  setUpProblems,
  type SetUpDuty,
  type SetUpHire,
} from "../domain/office-setup.js";
import type { Role } from "../domain/role.js";
import type { RoleChange } from "../domain/role-changes.js";
import type { RoleHired } from "../domain/role-events.js";
import { RoleRefused } from "../domain/role-refused.js";
import type { UserRef } from "../domain/user.js";
import { OfficeSetupRepository } from "../ports/office-setup-repository.js";
import { Duties } from "./duties.js";
import type { DutyHolderSave } from "./duty-change-checks.js";
import { RoleService } from "./role-service.js";

/** One hire of a set-up, with the Role it adds. */
interface Hiring {
  readonly hire: SetUpHire;
  readonly change: RoleChange<RoleHired>;
}

/** What a set-up would save, and every reason it can't be. */
interface WeighedSetUp {
  readonly problems: readonly string[];
  readonly hirings: readonly Hiring[];
  readonly dutySaves: readonly DutyHolderSave[];
}

/**
 * Setting up an Office (spec §2.2, "Setting up an Office with nobody hired"): several hires, from
 * presets or from scratch, and the duties given to Roles other than their defaults, made all or
 * none. A duty may name a Role the same set-up hires. Each hire is judged as hiring it alone is,
 * and the duties by the duty rules and the registered checks, with the hires counted as hired.
 */
@Injectable()
export class OfficeSetup {
  constructor(
    private readonly repository: OfficeSetupRepository,
    private readonly roles: RoleService,
    private readonly duties: Duties,
    private readonly roleSkills: RoleSkills,
    private readonly engineReferences: EngineReferenceLock,
    private readonly events: EventBus,
  ) {}

  /** Every reason the set-up would be refused now, saving nothing; empty when it wouldn't. */
  async problems(
    hires: readonly SetUpHire[],
    duties: readonly SetUpDuty[],
  ): Promise<readonly string[]> {
    return (await this.weighed(hires, duties, new Date(), null)).problems;
  }

  /**
   * Hires everyone and gives every duty to its Role, as the user `savedBy` did or applied a
   * Proposal of it by the person `proposedBy`, all in one go. Refuses with RoleRefused and every
   * reason, saving nothing. Held under Engine's `EngineReferenceLock` from reading the engines
   * through the save, as hiring from scratch is; announced after.
   */
  async setUp(
    hires: readonly SetUpHire[],
    duties: readonly SetUpDuty[],
    savedBy: UserRef,
    proposedBy?: string,
  ): Promise<readonly Role[]> {
    const at = new Date();
    const { hirings, dutySaves } = await this.engineReferences.holding(async () => {
      const weighed = await this.weighed(hires, duties, at, savedBy, proposedBy);
      if (weighed.problems.length > 0) throw new RoleRefused(weighed.problems);
      const saved = await this.repository.save(
        weighed.hirings.map(({ change }) => change.role),
        weighed.dutySaves.map(({ duty, to }) => ({ duty, roleKey: to })),
        at,
      );
      if (!saved) throw new RoleRefused(await this.refusalAfterAFilledRole(hires, duties));
      return weighed;
    });
    for (const { change } of hirings) await this.events.publish(change.event);
    for (const { hire, change } of hirings) {
      if (hire.kind === "hire") {
        await this.roleSkills.assignToRole(change.role.key, hire.skills, savedBy);
      }
    }
    for (const { duty, from, to } of dutySaves) {
      await this.events.publish(new DutyHolderChanged(duty, from, to, at));
    }
    return hirings.map(({ change }) => change.role);
  }

  private async weighed(
    hires: readonly SetUpHire[],
    duties: readonly SetUpDuty[],
    hiredAt: Date,
    savedBy: UserRef | null,
    proposedBy?: string,
  ): Promise<WeighedSetUp> {
    const named = Object.fromEntries(
      (await this.duties.list()).map(({ duty, roleKey }) => [duty, roleKey]),
    );
    const problems = setUpProblems(hires, duties, named);
    const hirings: Hiring[] = [];
    for (const hire of hires) {
      try {
        hirings.push({ hire, change: await this.roles.hiring(hire, hiredAt, savedBy, proposedBy) });
      } catch (refusal) {
        if (!(refusal instanceof RoleRefused)) throw refusal;
        problems.push(...refusal.reasons.map((reason) => `${hireWords(hire)}: ${reason}`));
      }
    }
    const dutyChanges = await this.duties.weighedWithHires(duties, hires.map(hiredKeyOf));
    problems.push(...dutyChanges.problems);
    return { problems: [...new Set(problems)], hirings, dutySaves: dutyChanges.saves };
  }

  /** Someone was hired into one of the Roles meanwhile: refused as if they had been there before. */
  private async refusalAfterAFilledRole(
    hires: readonly SetUpHire[],
    duties: readonly SetUpDuty[],
  ): Promise<readonly string[]> {
    const { problems } = await this.weighed(hires, duties, new Date(), null);
    return problems.length > 0
      ? problems
      : ["One of these Roles was filled meanwhile, so nothing was set up; try again."];
  }
}
