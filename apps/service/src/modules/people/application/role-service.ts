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
  type RoleCardEdit,
} from "../domain/role-card.js";
import { changeRoleCard, hire } from "../domain/role-changes.js";
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
   * reason before saving either. Sessions started from now on get both; running ones keep theirs.
   */
  async changeCard(
    key: string,
    edit: RoleCardEdit,
    skills: readonly string[],
  ): Promise<RoleWithSkills> {
    const problems = [
      ...roleCardProblems(key, trimmedRoleCard(edit)),
      ...(await this.roleSkills.problemsWith(skills)),
    ];
    if (problems.length > 0) throw new RoleRefused(problems);
    const { role, event } = await this.repository.update(key, (stored) =>
      changeRoleCard(stored, edit, new Date()),
    );
    if (event) await this.events.publish(event);
    return { role, skills: await this.roleSkills.assignToRole(key, skills) };
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
