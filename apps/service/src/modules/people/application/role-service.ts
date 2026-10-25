import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  HARD_SWITCH_ENFORCEMENT,
  HARD_SWITCH_KEYS,
  type HardSwitchEnforcement,
  type HardSwitchKey,
} from "../domain/hard-switches.js";
import { KNOWN_ROLES } from "../domain/known-roles.js";
import { PRESETS, type Preset } from "../domain/presets.js";
import type { Role, RoleCardVersion } from "../domain/role.js";
import { ENGINE_MODELS, ENGINES, type Engine, type RoleCardEdit } from "../domain/role-card.js";
import { changeRoleCard, hire } from "../domain/role-changes.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { HIGHEST_TASK_LIMIT, LOWEST_TASK_LIMIT } from "../domain/task-limit.js";
import { RoleRepository } from "../ports/role-repository.js";

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
    private readonly events: EventBus,
  ) {}

  /** Refuses with every reason, before saving, also when someone already fills the Role. */
  async hire(roleKey: string, name: string): Promise<Role> {
    const hiredAt = new Date();
    const { role, event } = hire(roleKey, name, await this.repository.find(roleKey), hiredAt);
    if (!(await this.repository.add(role))) {
      // Someone was hired into the Role meanwhile: refuse as if they had been there before.
      hire(roleKey, name, await this.repository.find(roleKey), hiredAt);
      throw new Error(`The Role "${roleKey}" was filled and emptied again while hiring.`);
    }
    await this.events.publish(event);
    return role;
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

  async list(): Promise<readonly Role[]> {
    return this.repository.list();
  }

  async read(key: string): Promise<Role> {
    const role = await this.repository.find(key);
    if (!role) throw new RoleNotFound(key);
    return role;
  }

  /** Sessions started from now on run with the new version; running ones keep theirs. */
  async changeCard(key: string, edit: RoleCardEdit): Promise<Role> {
    const { role, event } = await this.repository.update(key, (stored) =>
      changeRoleCard(stored, edit, new Date()),
    );
    if (event) await this.events.publish(event);
    return role;
  }

  /** The change history: every version of the card, newest first, the first being the hire. */
  async cardVersions(key: string): Promise<readonly RoleCardVersion[]> {
    await this.read(key);
    return this.repository.versions(key);
  }
}
