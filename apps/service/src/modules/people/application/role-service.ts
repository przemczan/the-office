import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineModels,
  EngineReferenceLock,
  EngineSessions,
  offeredModels,
  type EngineCapability,
  type EngineId,
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
import { PRESETS, presetFor, type Preset } from "../domain/presets.js";
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
import { RoleRepository, type RoleUpdate } from "../ports/role-repository.js";
import { roleHistory, type RoleHistoryEntry } from "./role-history.js";
import { RoleOverrideChecks } from "./role-override-checks.js";

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
    readonly engine: EngineId;
    readonly models: readonly string[];
    /** One of `models`: what picking the engine fills in. */
    readonly defaultModel: string;
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
    private readonly roleOverrideChecks: RoleOverrideChecks,
    private readonly engineReferences: EngineReferenceLock,
  ) {}

  /**
   * Hires `name` into the preset's Role, as the user chose it or applied a Proposal of it by the
   * person `proposedBy`. Refuses with every reason, before saving, also when someone already fills
   * the Role.
   */
  async hire(roleKey: string, name: string, proposedBy?: string): Promise<RoleWithAssignments> {
    const hiredAt = new Date();
    const { role, event } = await this.hiringFromPreset(roleKey, name, hiredAt, proposedBy);
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
    return refusalReasons(() => this.hiringFromPreset(roleKey, name, new Date()));
  }

  /** Presets carry no Role override today; the check still weighs the card the hire brings. */
  private async hiringFromPreset(
    roleKey: string,
    name: string,
    hiredAt: Date,
    proposedBy?: string,
  ): Promise<RoleChange<RoleHired>> {
    const filledBy = await this.repository.find(roleKey);
    const preset = presetFor(roleKey);
    const problems = preset ? await this.roleOverrideProblems(roleKey, filledBy, preset.card) : [];
    return refusingAlso(problems, () => hire(roleKey, name, filledBy, hiredAt, proposedBy));
  }

  /**
   * Hires the person on `card` into a new Role keyed from its title, with exactly `skills`, as the
   * user wrote the card or applied a Proposal of it by the person `proposedBy`. Refuses with every
   * reason before saving either, also when someone already fills that Role. Held under Engine's
   * `EngineReferenceLock` from reading the engines through the hire, as the card's Role override
   * names one.
   */
  async hireFromScratch(
    card: RoleCard,
    skills: readonly string[],
    proposedBy?: string,
  ): Promise<RoleWithAssignments> {
    const hiredAt = new Date();
    const { role, event } = await this.engineReferences.holding(async () => {
      const hiring = await this.hiringFromScratch(card, skills, hiredAt, proposedBy);
      const { key } = hiring.role;
      if (!(await this.repository.add(hiring.role))) {
        // Someone was hired into the Role meanwhile: refuse as if they had been there before.
        const offered = await this.engineModels.modelsOffered();
        hireFromScratch(key, card, offered, await this.repository.find(key), hiredAt);
        throw new Error(`The Role "${key}" was filled and emptied again while hiring.`);
      }
      return hiring;
    });
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
    const offered = await this.engineModels.modelsOffered();
    const filledBy = await this.repository.find(roleKey);
    const problems = [
      ...(await this.roleSkills.problemsWith(skills)),
      ...(await this.roleOverrideProblems(roleKey, filledBy, card)),
    ];
    return refusingAlso(problems, () =>
      hireFromScratch(roleKey, card, offered, filledBy, hiredAt, proposedBy),
    );
  }

  presets(): readonly Preset[] {
    return PRESETS;
  }

  async cardOptions(): Promise<RoleCardOptions> {
    const engines = await this.engineModels.engines();
    return {
      engines: engines.map((engine) => ({
        engine: engine.id,
        models: offeredModels(engine),
        defaultModel: engine.defaultModel,
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
   * `proposedBy`. Sessions started from now on get both; running ones keep theirs. Held under
   * Engine's `EngineReferenceLock` from reading the engines through the save, as the card's Role
   * override names one.
   */
  async changeCard(
    key: string,
    edit: RoleCard,
    skills: readonly string[],
    proposedBy?: string,
  ): Promise<RoleWithAssignments> {
    const saved = await this.engineReferences.holding(() =>
      this.savedCard(key, edit, skills, proposedBy),
    );
    return this.announcedWithSkills(saved, skills);
  }

  /** Saves the card as `changeCard` describes; the caller holds the `EngineReferenceLock`. */
  private async savedCard(
    key: string,
    edit: RoleCard,
    skills: readonly string[],
    proposedBy?: string,
  ): Promise<RoleUpdate> {
    const offered = await this.engineModels.modelsOffered();
    const filledBy = await this.repository.find(key);
    const problems = [
      ...roleCardProblems(key, trimmedRoleCard(edit), offered),
      ...(await this.roleSkills.problemsWith(skills)),
      // Nobody filling the Role is refused as RoleNotFound by the update below.
      ...(filledBy ? await this.roleOverrideProblems(key, filledBy, edit) : []),
    ];
    if (problems.length > 0) throw new RoleRefused(problems);
    return this.repository.update(key, (stored) =>
      changeRoleCard(stored, edit, offered, new Date(), proposedBy),
    );
  }

  /** Announces the saved card, outside the lock, and gives the Role exactly `skills`. */
  private async announcedWithSkills(
    { role, event }: RoleUpdate,
    skills: readonly string[],
  ): Promise<RoleWithAssignments> {
    if (event) await this.events.publish(event);
    return {
      role,
      skills: await this.roleSkills.assignToRole(role.key, skills),
      mcpServers: await this.roleMcpServers.serversOf(role.key),
    };
  }

  /**
   * Every reason saving `edit` as the Role's card would be refused now, saving nothing; empty when
   * it wouldn't. Throws RoleNotFound when there is no such Role.
   */
  async cardChangeProblems(key: string, edit: RoleCard): Promise<readonly string[]> {
    const { role } = await this.read(key);
    const offered = await this.engineModels.modelsOffered();
    const reasons = await refusalReasons(() =>
      Promise.resolve(changeRoleCard(role, edit, offered, new Date())),
    );
    return [...new Set([...reasons, ...(await this.roleOverrideProblems(key, role, edit))])];
  }

  /**
   * What the registered checks refuse in giving the Role `roleKey`, `stored` until now, the card
   * `edit`. They weigh the Role as read just before, so a change made in between goes unchecked.
   */
  private roleOverrideProblems(
    roleKey: string,
    stored: Role | undefined,
    edit: Pick<RoleCard, "roleOverride">,
  ): Promise<readonly string[]> {
    return this.roleOverrideChecks.problemsOf({
      roleKey,
      before: stored?.card.roleOverride ?? null,
      after: edit.roleOverride,
    });
  }

  /**
   * Saves the card with these words changed and nothing else, as `changeCard` does, as proposed by
   * the person filling `proposedBy`. The card is read under the same hold as the save, so a
   * removal can't move its Role override in between.
   */
  async reword(
    key: string,
    words: Partial<Pick<RoleCard, "responsibilities" | "instructions">>,
    proposedBy: string,
  ): Promise<RoleWithAssignments> {
    const { saved, skills } = await this.engineReferences.holding(async () => {
      const current = await this.read(key);
      const edit = { ...current.role.card, ...words };
      return {
        saved: await this.savedCard(key, edit, current.skills, proposedBy),
        skills: current.skills,
      };
    });
    return this.announcedWithSkills(saved, skills);
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

  /**
   * Hires the person let go back into their Role, with their card, Memory and chats as they were.
   * Refused when the Role override returning with the card fails a registered check: while let go,
   * the Role ran without it.
   */
  async hireBack(key: string): Promise<RoleWithAssignments> {
    const person = await this.repository.find(key);
    // Anyone else (nobody let go, never hired) is refused by the change below.
    if (person?.letGoAt) {
      const problems = await this.roleOverrideProblems(key, undefined, person.card);
      if (problems.length > 0) throw new RoleRefused(problems);
    }
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
