import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  dutiesHeldBy,
  dutyChangeProblems,
  dutyFor,
  dutyHolding,
  dutyHoldings,
  hiredKeysOf,
  isDutyKey,
  mcpToolDefault,
  type DutyAssignments,
  type DutyHolding,
  type DutyKey,
} from "../domain/duties.js";
import { DutyHolderChanged } from "../domain/duty-events.js";
import { DutyNotFound, DutyRefused } from "../domain/duty-refused.js";
import type { HardSwitchValue } from "../domain/hard-switches.js";
import type { Role } from "../domain/role.js";
import { DutyRepository } from "../ports/duty-repository.js";
import { RoleRepository } from "../ports/role-repository.js";
import { DutyChangeChecks, type DutyHolderSave } from "./duty-change-checks.js";

/** The person holding a duty. */
export interface DutyHolder {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
}

/** A duty's holding, with its holder's name and title. */
export interface DutyWithHolder extends Omit<DutyHolding, "holder"> {
  readonly holder: DutyHolder | null;
}

/**
 * A duty to set to the Role keyed `to`, or to none. `from` is the Role key it named as the change
 * was drafted, refused when it names another now; without it, whatever it names now is replaced.
 */
export interface DutyChange {
  readonly duty: string;
  readonly from?: string | null;
  readonly to: string | null;
}

/** The duties and the Roles as they stand, read together. */
interface DutiesNow {
  readonly assignments: DutyAssignments;
  readonly roles: readonly Role[];
  readonly hiredKeys: ReadonlySet<string>;
}

/** What a set of changes would save, and why it can't be. */
interface WeighedChanges {
  readonly problems: readonly string[];
  readonly saves: readonly DutyHolderSave[];
}

/**
 * Who holds each duty, and the user's changes to them (spec §2.2, "Who holds a duty"). Each change
 * is saved first and announced after, so nothing hears of a change that wasn't kept.
 */
@Injectable()
export class Duties {
  constructor(
    private readonly repository: DutyRepository,
    private readonly roles: RoleRepository,
    private readonly checks: DutyChangeChecks,
    private readonly events: EventBus,
  ) {}

  /** Every duty, in spec order. */
  async list(): Promise<DutyWithHolder[]> {
    const now = await this.now();
    return dutyHoldings(now.assignments, now.hiredKeys).map((holding) =>
      withHolder(holding, now.roles),
    );
  }

  /** The duty keyed `duty`; throws DutyNotFound for a key no duty has. */
  async read(duty: string): Promise<DutyWithHolder> {
    if (!isDutyKey(duty)) throw new DutyNotFound(duty);
    const now = await this.now();
    return withHolder(dutyHolding(duty, now.assignments, now.hiredKeys), now.roles);
  }

  /** The key of the hired Role holding `duty`; undefined while nobody does. */
  async holderOf(duty: DutyKey): Promise<string | undefined> {
    const now = await this.now();
    return dutyHolding(duty, now.assignments, now.hiredKeys).holder ?? undefined;
  }

  /** The duties the Role keyed `roleKey` holds, none while it isn't hired. */
  async heldBy(roleKey: string): Promise<DutyKey[]> {
    const now = await this.now();
    return dutiesHeldBy(roleKey, now.assignments, now.hiredKeys);
  }

  /**
   * Who an MCP tool never set consults: the holder of Default Consultant for MCP tool hard
   * switches, passed over while their Consultant capability is off (spec §2.2), so the user is
   * asked instead.
   */
  async mcpConsultant(): Promise<string | undefined> {
    const now = await this.now();
    const { holder } = dutyHolding("mcp-tool-consultant", now.assignments, now.hiredKeys);
    const role = now.roles.find((each) => each.key === holder);
    return role?.card.capabilities.consultant ? role.key : undefined;
  }

  /** Where an MCP tool stands until the user sets it. */
  async mcpToolDefault(): Promise<HardSwitchValue> {
    return mcpToolDefault(await this.mcpConsultant());
  }

  /** Every reason `changes` would be refused now, saving nothing; empty when they wouldn't. */
  async changeProblems(changes: readonly DutyChange[]): Promise<readonly string[]> {
    return (await this.weighed(changes, await this.now())).problems;
  }

  /**
   * Sets `duty` to the Role keyed `roleKey`, or to none. Throws DutyNotFound for a key no duty has,
   * and DutyRefused with every reason, saving nothing, when the change breaks a rule or a
   * registered check.
   */
  async change(duty: string, roleKey: string | null): Promise<DutyWithHolder> {
    if (!isDutyKey(duty)) throw new DutyNotFound(duty);
    await this.changeAll([{ duty, to: roleKey }]);
    return this.read(duty);
  }

  /**
   * Makes every change or none, refusing with DutyRefused when any breaks a rule, or names
   * another Role than its `from` now, as a Proposal applied after the value changed.
   */
  async changeAll(changes: readonly DutyChange[]): Promise<void> {
    const { problems, saves } = await this.weighed(changes, await this.now());
    if (problems.length > 0) throw new DutyRefused(problems);
    if (saves.length === 0) return;
    const changedAt = new Date();
    await this.repository.assignAll(
      saves.map(({ duty, to }) => ({ duty, roleKey: to })),
      changedAt,
    );
    for (const { duty, from, to } of saves) {
      await this.events.publish(new DutyHolderChanged(duty, from, to, changedAt));
    }
  }

  private async weighed(changes: readonly DutyChange[], now: DutiesNow): Promise<WeighedChanges> {
    const problems: string[] = [];
    const saves: DutyHolderSave[] = [];
    const seen = new Set<string>();
    for (const { duty, from, to } of changes) {
      const ruleProblems = dutyChangeProblems(duty, to, now.hiredKeys);
      problems.push(...ruleProblems);
      if (!isDutyKey(duty)) continue;
      const { label } = dutyFor(duty);
      if (seen.has(duty)) {
        problems.push(`${label} is changed only once at a time.`);
        continue;
      }
      seen.add(duty);
      const current = dutyHolding(duty, now.assignments, now.hiredKeys).roleKey;
      if (from !== undefined && from !== current) {
        problems.push(`${label} was changed meanwhile, so this change no longer applies.`);
      } else if (ruleProblems.length === 0 && to !== current) {
        saves.push({ duty, from: current, to });
      }
    }
    for (const save of saves) problems.push(...(await this.checks.problemsOf(save)));
    return { problems: [...new Set(problems)], saves };
  }

  private async now(): Promise<DutiesNow> {
    const [assignments, roles] = await Promise.all([
      this.repository.assignments(),
      this.roles.list(),
    ]);
    return { assignments, roles, hiredKeys: hiredKeysOf(roles) };
  }
}

function withHolder(holding: DutyHolding, roles: readonly Role[]): DutyWithHolder {
  const role = roles.find((each) => each.key === holding.holder);
  return {
    ...holding,
    holder: role ? { roleKey: role.key, name: role.card.name, title: role.card.title } : null,
  };
}
