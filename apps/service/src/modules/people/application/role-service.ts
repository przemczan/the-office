import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleSkills } from "../../skills/index.js";
import {
  HARD_SWITCH_ENFORCEMENT,
  HARD_SWITCH_KEYS,
  type HardSwitchEnforcement,
  type HardSwitchKey,
} from "../domain/hard-switches.js";
import { KNOWN_ROLES } from "../domain/known-roles.js";
import { PRESETS, type Preset } from "../domain/presets.js";
import type { Role } from "../domain/role.js";
import {
  ENGINE_MODELS,
  ENGINES,
  roleCardProblems,
  trimmedRoleCard,
  type Engine,
  type RoleCard,
} from "../domain/role-card.js";
import {
  changeRoleCard,
  hire,
  hireBack,
  hireFromScratch,
  letGo,
  type RoleChange,
} from "../domain/role-changes.js";
import type { RoleHired } from "../domain/role-events.js";
import { roleKeyFor } from "../domain/role-key.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRefused } from "../domain/role-refused.js";
import { HIGHEST_TASK_LIMIT, LOWEST_TASK_LIMIT } from "../domain/task-limit.js";
import { RoleRepository } from "../ports/role-repository.js";
import { roleHistory, type RoleHistoryEntry } from "./role-history.js";

/** A Role with the library skills its card names, which the Skills module keeps. */
export interface RoleWithSkills {
  readonly role: Role;
  readonly skills: readonly string[];
}

/** The choices the Role card form offers, and how each Hard switch is seen to. */
export interface RoleCardOptions {
  readonly engines: readonly { readonly engine: Engine; readonly models: readonly string[] }[];
  /** Every Role a Consult value may name, hired or not. */
  readonly knownRoles: readonly { readonly key: string; readonly title: string }[];
  readonly hardSwitches: readonly {
    readonly key: HardSwitchKey;
    readonly enforcement: HardSwitchEnforcement;
  }[];
  readonly taskLimits: { readonly lowest: number; readonly highest: number };
}

/** Runs `change`, refusing with its reasons followed by `problems`, which also refuse alone. */
function refusingAlso<Change>(problems: readonly string[], change: () => Change): Change {
  try {
    const changed = change();
    if (problems.length > 0) throw new RoleRefused(problems);
    return changed;
  } catch (refusal) {
    if (!(refusal instanceof RoleRefused) || problems.length === 0) throw refusal;
    throw new RoleRefused([...new Set([...refusal.reasons, ...problems])]);
  }
}

/** The reasons `change` is refused with; empty when it isn't. */
async function refusalReasons(change: () => Promise<unknown>): Promise<readonly string[]> {
  try {
    await change();
    return [];
  } catch (refusal) {
    if (refusal instanceof RoleRefused) return refusal.reasons;
    throw refusal;
  }
}

/**
 * The People use cases. Each change is saved first and its event published after, so nothing
 * hears of a change that wasn't kept.
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly repository: RoleRepository,
    private readonly roleSkills: RoleSkills,
    private readonly events: EventBus,
  ) {}

  /** Refuses with every reason, before saving, also when someone already fills the Role. */
  async hire(roleKey: string, name: string): Promise<RoleWithSkills> {
    const hiredAt = new Date();
    const { role, event } = hire(roleKey, name, await this.repository.find(roleKey), hiredAt);
    if (!(await this.repository.add(role))) {
      // Someone was hired into the Role meanwhile: refuse as if they had been there before.
      hire(roleKey, name, await this.repository.find(roleKey), hiredAt);
      throw new Error(`The Role "${roleKey}" was filled and emptied again while hiring.`);
    }
    await this.events.publish(event);
    return { role, skills: await this.roleSkills.of(role.key) };
  }

  /**
   * Hires the person on `card` into a new Role keyed from its title, with exactly `skills`, as the
   * user wrote the card or applied a Proposal of it by the person `proposedBy`. Refuses with every
   * reason before saving either, also when someone already fills that Role.
   */
  async hireFromScratch(
    card: RoleCard,
    skills: readonly string[],
    proposedBy?: string,
  ): Promise<RoleWithSkills> {
    const hiredAt = new Date();
    const { role, event } = await this.hiringFromScratch(card, skills, hiredAt, proposedBy);
    if (!(await this.repository.add(role))) {
      // Someone was hired into the Role meanwhile: refuse as if they had been there before.
      hireFromScratch(role.key, card, await this.repository.find(role.key), hiredAt);
      throw new Error(`The Role "${role.key}" was filled and emptied again while hiring.`);
    }
    await this.events.publish(event);
    return { role, skills: await this.roleSkills.assignToRole(role.key, skills) };
  }

  /** Every reason hiring from scratch would be refused now, saving nothing; empty when it wouldn't. */
  async hiringProblems(card: RoleCard, skills: readonly string[]): Promise<readonly string[]> {
    return refusalReasons(() => this.hiringFromScratch(card, skills, new Date()));
  }

  private async hiringFromScratch(
    card: RoleCard,
    skills: readonly string[],
    hiredAt: Date,
    proposedBy?: string,
  ): Promise<RoleChange<RoleHired>> {
    const roleKey = roleKeyFor(card.title);
    const skillProblems = await this.roleSkills.problemsWith(skills);
    const filledBy = await this.repository.find(roleKey);
    return refusingAlso(skillProblems, () =>
      hireFromScratch(roleKey, card, filledBy, hiredAt, proposedBy),
    );
  }

  presets(): readonly Preset[] {
    return PRESETS;
  }

  cardOptions(): RoleCardOptions {
    return {
      engines: ENGINES.map((engine) => ({ engine, models: ENGINE_MODELS[engine] })),
      knownRoles: [...KNOWN_ROLES].map(([key, title]) => ({ key, title })),
      hardSwitches: HARD_SWITCH_KEYS.map((key) => ({
        key,
        enforcement: HARD_SWITCH_ENFORCEMENT[key],
      })),
      taskLimits: { lowest: LOWEST_TASK_LIMIT, highest: HIGHEST_TASK_LIMIT },
    };
  }

  async list(): Promise<readonly RoleWithSkills[]> {
    const skills = await this.roleSkills.byRole();
    return (await this.repository.list()).map((role) => ({
      role,
      skills: skills.get(role.key) ?? [],
    }));
  }

  async read(key: string): Promise<RoleWithSkills> {
    const role = await this.repository.find(key);
    if (!role) throw new RoleNotFound(key);
    return { role, skills: await this.roleSkills.of(key) };
  }

  /**
   * Saves the card as its next version and gives the Role exactly `skills`, refusing with every
   * reason before saving either. The user wrote the card, or applied a Proposal of it by the person
   * `proposedBy`. Sessions started from now on get both; running ones keep theirs.
   */
  async changeCard(
    key: string,
    edit: RoleCard,
    skills: readonly string[],
    proposedBy?: string,
  ): Promise<RoleWithSkills> {
    const problems = [
      ...roleCardProblems(key, trimmedRoleCard(edit)),
      ...(await this.roleSkills.problemsWith(skills)),
    ];
    if (problems.length > 0) throw new RoleRefused(problems);
    const { role, event } = await this.repository.update(key, (stored) =>
      changeRoleCard(stored, edit, new Date(), proposedBy),
    );
    if (event) await this.events.publish(event);
    return { role, skills: await this.roleSkills.assignToRole(key, skills) };
  }

  /**
   * Every reason saving `edit` as the Role's card would be refused now, saving nothing; empty when
   * it wouldn't. Throws RoleNotFound when there is no such Role.
   */
  async cardChangeProblems(key: string, edit: RoleCard): Promise<readonly string[]> {
    const { role } = await this.read(key);
    return refusalReasons(() => Promise.resolve(changeRoleCard(role, edit, new Date())));
  }

  /** Saves the card with these words changed and nothing else, as `changeCard` does. */
  async reword(
    key: string,
    words: Partial<Pick<RoleCard, "responsibilities" | "instructions">>,
  ): Promise<RoleWithSkills> {
    const { role, skills } = await this.read(key);
    return this.changeCard(key, { ...role.card, ...words }, skills);
  }

  /**
   * Lets the person go: nobody fills the Role from now on, and their card, Memory and chats stay,
   * unused and readable. Refused when they were let go already.
   */
  async letGo(key: string): Promise<RoleWithSkills> {
    const { role, event } = await this.repository.changeStanding(key, (stored) =>
      letGo(stored, new Date()),
    );
    await this.events.publish(event);
    return { role, skills: await this.roleSkills.of(key) };
  }

  /** Hires the person let go back into their Role, with their card, Memory and chats as they were. */
  async hireBack(key: string): Promise<RoleWithSkills> {
    const { role, event } = await this.repository.changeStanding(key, (stored) =>
      hireBack(stored, new Date()),
    );
    await this.events.publish(event);
    return { role, skills: await this.roleSkills.of(key) };
  }

  /** The person's change history, newest first, ending with the hire. */
  async history(key: string): Promise<readonly RoleHistoryEntry[]> {
    const { role } = await this.read(key);
    return roleHistory(
      role.hiredAt,
      await this.repository.versions(key),
      await this.roleSkills.changes(key),
    );
  }
}
