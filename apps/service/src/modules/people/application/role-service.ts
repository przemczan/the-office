import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineModels,
  EngineSessions,
  type RoleEngine,
  type EngineCapability,
} from "../../engine/index.js";
import { RoleMcpServers, type McpServerOnCard } from "../../mcp-servers/index.js";
import { RoleSkills } from "../../skills/index.js";
import {
  HARD_SWITCH_ENFORCEMENT,
  HARD_SWITCH_KEYS,
  type HardSwitchEnforcement,
  type HardSwitchKey,
  type HardSwitchValue,
} from "../domain/hard-switches.js";
import { KNOWN_ROLES } from "../domain/known-roles.js";
import { MCP_TOOL_DEFAULT } from "../domain/mcp-tool-settings.js";
import { PRESETS, type Preset } from "../domain/presets.js";
import type { Role } from "../domain/role.js";
import { roleCardProblems, trimmedRoleCard, type RoleCard } from "../domain/role-card.js";
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

/**
 * A Role with what its card names from the libraries: its skills, which the Skills module keeps,
 * and its MCP servers, which the MCP servers module keeps.
 */
export interface RoleWithAssignments {
  readonly role: Role;
  readonly skills: readonly string[];
  readonly mcpServers: readonly McpServerOnCard[];
}

/** The choices the Role card form offers, and how each Hard switch is seen to. */
export interface RoleCardOptions {
  readonly engines: readonly {
    readonly engine: RoleEngine;
    readonly models: readonly string[];
    /** What the engine declares it can't do. */
    readonly missingCapabilities: readonly EngineCapability[];
  }[];
  /** Every Role a Consult value may name, hired or not. */
  readonly knownRoles: readonly { readonly key: string; readonly title: string }[];
  readonly hardSwitches: readonly {
    readonly key: HardSwitchKey;
    readonly enforcement: HardSwitchEnforcement;
  }[];
  /** Where an MCP tool's setting starts, until the user sets it. */
  readonly mcpToolDefault: HardSwitchValue;
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
    private readonly roleMcpServers: RoleMcpServers,
    private readonly engineModels: EngineModels,
    private readonly engineSessions: EngineSessions,
    private readonly events: EventBus,
  ) {}

  /**
   * Hires `name` into the preset's Role, as the user chose it or applied a Proposal of it by the
   * person `proposedBy`. Refuses with every reason, before saving, also when someone already fills
   * the Role.
   */
  async hire(roleKey: string, name: string, proposedBy?: string): Promise<RoleWithAssignments> {
    const hiredAt = new Date();
    const filledBy = await this.repository.find(roleKey);
    const { role, event } = hire(roleKey, name, filledBy, hiredAt, proposedBy);
    if (!(await this.repository.add(role))) {
      // Someone was hired into the Role meanwhile: refuse as if they had been there before.
      hire(roleKey, name, await this.repository.find(roleKey), hiredAt);
      throw new Error(`The Role "${roleKey}" was filled and emptied again while hiring.`);
    }
    await this.events.publish(event);
    return this.withAssignments(role);
  }

  /** Every reason hiring `name` from the preset would be refused now, saving nothing. */
  async presetHiringProblems(roleKey: string, name: string): Promise<readonly string[]> {
    const filledBy = await this.repository.find(roleKey);
    return refusalReasons(async () => hire(roleKey, name, filledBy, new Date()));
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
  ): Promise<RoleWithAssignments> {
    const hiredAt = new Date();
    const { role, event } = await this.hiringFromScratch(card, skills, hiredAt, proposedBy);
    if (!(await this.repository.add(role))) {
      // Someone was hired into the Role meanwhile: refuse as if they had been there before.
      const offeredModels = await this.engineModels.offeredBy(card.engine);
      hireFromScratch(role.key, card, offeredModels, await this.repository.find(role.key), hiredAt);
      throw new Error(`The Role "${role.key}" was filled and emptied again while hiring.`);
    }
    await this.events.publish(event);
    return {
      role,
      skills: await this.roleSkills.assignToRole(role.key, skills),
      mcpServers: await this.roleMcpServers.serversOf(role.key),
    };
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
    const offeredModels = await this.engineModels.offeredBy(card.engine);
    const filledBy = await this.repository.find(roleKey);
    return refusingAlso(skillProblems, () =>
      hireFromScratch(roleKey, card, offeredModels, filledBy, hiredAt, proposedBy),
    );
  }

  presets(): readonly Preset[] {
    return PRESETS;
  }

  async cardOptions(): Promise<RoleCardOptions> {
    const models = await this.engineModels.byEngine();
    return {
      engines: [...models].map(([engine, offered]) => ({
        engine,
        models: offered,
        missingCapabilities: this.engineSessions.missingCapabilitiesOf(engine),
      })),
      knownRoles: [...KNOWN_ROLES].map(([key, title]) => ({ key, title })),
      hardSwitches: HARD_SWITCH_KEYS.map((key) => ({
        key,
        enforcement: HARD_SWITCH_ENFORCEMENT[key],
      })),
      mcpToolDefault: MCP_TOOL_DEFAULT,
      taskLimits: { lowest: LOWEST_TASK_LIMIT, highest: HIGHEST_TASK_LIMIT },
    };
  }

  async list(): Promise<readonly RoleWithAssignments[]> {
    const skills = await this.roleSkills.byRole();
    const mcpServers = await this.roleMcpServers.byRole();
    return (await this.repository.list()).map((role) => ({
      role,
      skills: skills.get(role.key) ?? [],
      mcpServers: mcpServers.get(role.key) ?? [],
    }));
  }

  async read(key: string): Promise<RoleWithAssignments> {
    const role = await this.repository.find(key);
    if (!role) throw new RoleNotFound(key);
    return this.withAssignments(role);
  }

  private async withAssignments(role: Role): Promise<RoleWithAssignments> {
    return {
      role,
      skills: await this.roleSkills.of(role.key),
      mcpServers: await this.roleMcpServers.serversOf(role.key),
    };
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
  ): Promise<RoleWithAssignments> {
    const offeredModels = await this.engineModels.offeredBy(edit.engine);
    const problems = [
      ...roleCardProblems(key, trimmedRoleCard(edit), offeredModels),
      ...(await this.roleSkills.problemsWith(skills)),
    ];
    if (problems.length > 0) throw new RoleRefused(problems);
    const { role, event } = await this.repository.update(key, (stored) =>
      changeRoleCard(stored, edit, offeredModels, new Date(), proposedBy),
    );
    if (event) await this.events.publish(event);
    return {
      role,
      skills: await this.roleSkills.assignToRole(key, skills),
      mcpServers: await this.roleMcpServers.serversOf(key),
    };
  }

  /**
   * Every reason saving `edit` as the Role's card would be refused now, saving nothing; empty when
   * it wouldn't. Throws RoleNotFound when there is no such Role.
   */
  async cardChangeProblems(key: string, edit: RoleCard): Promise<readonly string[]> {
    const { role } = await this.read(key);
    const offeredModels = await this.engineModels.offeredBy(edit.engine);
    return refusalReasons(() =>
      Promise.resolve(changeRoleCard(role, edit, offeredModels, new Date())),
    );
  }

  /**
   * Saves the card with these words changed and nothing else, as `changeCard` does, as proposed by
   * the person filling `proposedBy`.
   */
  async reword(
    key: string,
    words: Partial<Pick<RoleCard, "responsibilities" | "instructions">>,
    proposedBy: string,
  ): Promise<RoleWithAssignments> {
    const { role, skills } = await this.read(key);
    return this.changeCard(key, { ...role.card, ...words }, skills, proposedBy);
  }

  /**
   * Lets the person go: nobody fills the Role from now on, and their card, Memory and chats stay,
   * unused and readable. Refused when they were let go already.
   */
  async letGo(key: string): Promise<RoleWithAssignments> {
    const { role, event } = await this.repository.changeStanding(key, (stored) =>
      letGo(stored, new Date()),
    );
    await this.events.publish(event);
    return this.withAssignments(role);
  }

  /** Hires the person let go back into their Role, with their card, Memory and chats as they were. */
  async hireBack(key: string): Promise<RoleWithAssignments> {
    const { role, event } = await this.repository.changeStanding(key, (stored) =>
      hireBack(stored, new Date()),
    );
    await this.events.publish(event);
    return this.withAssignments(role);
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
