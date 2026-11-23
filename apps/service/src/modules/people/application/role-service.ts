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
import { mcpToolDefault } from "../domain/duties.js";
import {
  engineTypeOptions,
  engineTypesOffered,
  type EngineTypeOption,
} from "../domain/engine-type-offers.js";
import type { SetUpHire } from "../domain/office-setup.js";
import { consultableRoleKeys, PRESETS, presetTitle, type Preset } from "../domain/presets.js";
import type { Role } from "../domain/role.js";
import {
  roleCardProblems,
  trimmedRoleCard,
  type RoleCard,
  type RoleCardContext,
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
import type { UserRef } from "../domain/user.js";
import { RoleRepository, type RoleUpdate } from "../ports/role-repository.js";
import { Duties } from "./duties.js";
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
  /** Every engine type, with the models and efforts a person's settings on it may name. */
  readonly engineTypes: readonly EngineTypeOption[];
  /** The engines the Project's and the Task's pickers offer. */
  readonly engines: readonly {
    readonly engine: EngineId;
    readonly models: readonly string[];
    /** One of `models`: what picking the engine fills in. */
    readonly defaultModel: string;
    /** What the engine declares it can't do. */
    readonly missingCapabilities: readonly EngineCapability[];
  }[];
  /** Every Role a Consult value may name: the presets', hired or not, and those hired from scratch. */
  readonly knownRoles: readonly { readonly key: string; readonly title: string }[];
  readonly hardSwitches: readonly {
    readonly key: HardSwitchKey;
    readonly enforcement: HardSwitchEnforcement;
  }[];
  /**
   * Where an MCP tool's setting starts, until the user sets it: consulting the holder of Default
   * Consultant for MCP tool hard switches, or Ask me while nobody holds it.
   */
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
    private readonly engineReferences: EngineReferenceLock,
    private readonly duties: Duties,
  ) {}

  /**
   * Hires `name` into the preset's Role, as the user `savedBy` chose it or applied a Proposal of it
   * by the person `proposedBy`. Refuses with every reason, before saving, also when someone already
   * fills the Role.
   */
  async hire(
    roleKey: string,
    name: string,
    savedBy: UserRef,
    proposedBy?: string,
  ): Promise<RoleWithAssignments> {
    const hiredAt = new Date();
    const { role, event } = await this.hiringFromPreset(
      roleKey,
      name,
      hiredAt,
      savedBy,
      proposedBy,
    );
    if (!(await this.repository.add(role))) {
      // Someone was hired into the Role meanwhile: refuse as if they had been there before.
      hire(roleKey, name, await this.repository.find(roleKey), hiredAt, savedBy);
      throw new Error(`The Role "${roleKey}" was filled and emptied again while hiring.`);
    }
    await this.events.publish(event);
    return this.withAssignments(role);
  }

  /** Every reason hiring `name` from the preset would be refused now, saving nothing. */
  async presetHiringProblems(roleKey: string, name: string): Promise<readonly string[]> {
    return refusalReasons(() => this.hiringFromPreset(roleKey, name, new Date(), null));
  }

  /** A person names no engine, so the hire isn't weighed against the engines (spec §5.4.5). */
  private async hiringFromPreset(
    roleKey: string,
    name: string,
    hiredAt: Date,
    savedBy: UserRef | null,
    proposedBy?: string,
  ): Promise<RoleChange<RoleHired>> {
    const filledBy = await this.repository.find(roleKey);
    return hire(roleKey, name, filledBy, hiredAt, savedBy, proposedBy);
  }

  /**
   * Hires the person on `card` into a new Role keyed from its title, with exactly `skills`, as the
   * user `savedBy` wrote the card or applied a Proposal of it by the person `proposedBy`. Refuses
   * with every reason before saving either, also when someone already fills that Role. Held under Engine's
   * `EngineReferenceLock` from reading the engines through the hire, as the card's Role override
   * names one.
   */
  async hireFromScratch(
    card: RoleCard,
    skills: readonly string[],
    savedBy: UserRef,
    proposedBy?: string,
  ): Promise<RoleWithAssignments> {
    const hiredAt = new Date();
    const { role, event } = await this.engineReferences.holding(async () => {
      const hiring = await this.hiringFromScratch(card, skills, hiredAt, savedBy, proposedBy);
      const { key } = hiring.role;
      if (!(await this.repository.add(hiring.role))) {
        // Someone was hired into the Role meanwhile: refuse as if they had been there before.
        const context = await this.cardContext();
        hireFromScratch(key, card, context, await this.repository.find(key), hiredAt, savedBy);
        throw new Error(`The Role "${key}" was filled and emptied again while hiring.`);
      }
      return hiring;
    });
    await this.events.publish(event);
    return {
      role,
      skills: await this.roleSkills.assignToRole(role.key, skills, savedBy),
      mcpServers: await this.roleMcpServers.serversOf(role.key),
    };
  }

  /** Every reason hiring from scratch would be refused now, saving nothing; empty when it wouldn't. */
  async hiringProblems(card: RoleCard, skills: readonly string[]): Promise<readonly string[]> {
    return refusalReasons(() => this.hiringFromScratch(card, skills, new Date(), null));
  }

  private async hiringFromScratch(
    card: RoleCard,
    skills: readonly string[],
    hiredAt: Date,
    savedBy: UserRef | null,
    proposedBy?: string,
  ): Promise<RoleChange<RoleHired>> {
    const roleKey = roleKeyFor(card.title);
    const context = await this.cardContext();
    const filledBy = await this.repository.find(roleKey);
    const problems = await this.roleSkills.problemsWith(skills);
    return refusingAlso(problems, () =>
      hireFromScratch(roleKey, card, context, filledBy, hiredAt, savedBy, proposedBy),
    );
  }

  /**
   * The Role `setUpHire` would add, from a preset or from scratch, judged as hiring it alone is; saves
   * nothing, and throws RoleRefused with every reason. An Office set-up keeps several together.
   */
  hiring(
    setUpHire: SetUpHire,
    hiredAt: Date,
    savedBy: UserRef | null,
    proposedBy?: string,
  ): Promise<RoleChange<RoleHired>> {
    return setUpHire.kind === "hire-from-preset"
      ? this.hiringFromPreset(setUpHire.roleKey, setUpHire.name, hiredAt, savedBy, proposedBy)
      : this.hiringFromScratch(setUpHire.card, setUpHire.skills, hiredAt, savedBy, proposedBy);
  }

  presets(): readonly Preset[] {
    return PRESETS;
  }

  async cardOptions(): Promise<RoleCardOptions> {
    const engines = await this.engineModels.engines();
    const roles = await this.repository.list();
    const { consultable, mcpConsultant } = await this.cardContext();
    return {
      engineTypes: engineTypeOptions(engines),
      engines: engines.map((engine) => ({
        engine: engine.id,
        models: offeredModels(engine),
        defaultModel: engine.defaultModel,
        missingCapabilities: this.engineSessions.missingCapabilitiesOf(engine),
      })),
      knownRoles: [...consultable].map((key) => ({ key, title: consultableTitle(key, roles) })),
      hardSwitches: HARD_SWITCH_KEYS.map((key) => ({
        key,
        enforcement: HARD_SWITCH_ENFORCEMENT[key],
      })),
      mcpToolDefault: mcpToolDefault(mcpConsultant),
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
   * reason before saving either. The user `savedBy` wrote the card, or applied a Proposal of it by
   * the person `proposedBy`. Sessions started from now on get both; running ones keep theirs. Held under
   * Engine's `EngineReferenceLock` from reading the engines through the save, as the card's Role
   * override names one.
   */
  async changeCard(
    key: string,
    edit: RoleCard,
    skills: readonly string[],
    savedBy: UserRef,
    proposedBy?: string,
  ): Promise<RoleWithAssignments> {
    const saved = await this.engineReferences.holding(() =>
      this.savedCard(key, edit, skills, savedBy, proposedBy),
    );
    return this.announcedWithSkills(saved, skills, savedBy);
  }

  /** Saves the card as `changeCard` describes; the caller holds the `EngineReferenceLock`. */
  private async savedCard(
    key: string,
    edit: RoleCard,
    skills: readonly string[],
    savedBy: UserRef | null,
    proposedBy?: string,
  ): Promise<RoleUpdate> {
    const context = await this.cardContext();
    const filledBy = await this.repository.find(key);
    const problems = [
      ...roleCardProblems(key, trimmedRoleCard(edit), withStored(context, filledBy)),
      ...(await this.roleSkills.problemsWith(skills)),
    ];
    if (problems.length > 0) throw new RoleRefused(problems);
    return this.repository.update(key, (stored) =>
      changeRoleCard(stored, edit, withStored(context, stored), new Date(), savedBy, proposedBy),
    );
  }

  /**
   * Announces the saved card, outside the lock, and gives the Role exactly `skills`, as the user
   * `changedBy` changed them, or nobody named.
   */
  private async announcedWithSkills(
    { role, event }: RoleUpdate,
    skills: readonly string[],
    changedBy: UserRef | null,
  ): Promise<RoleWithAssignments> {
    if (event) await this.events.publish(event);
    return {
      role,
      skills: await this.roleSkills.assignToRole(role.key, skills, changedBy),
      mcpServers: await this.roleMcpServers.serversOf(role.key),
    };
  }

  /**
   * Every reason saving `edit` as the Role's card would be refused now, saving nothing; empty when
   * it wouldn't. Throws RoleNotFound when there is no such Role.
   */
  async cardChangeProblems(key: string, edit: RoleCard): Promise<readonly string[]> {
    const { role } = await this.read(key);
    const context = await this.cardContext();
    const reasons = await refusalReasons(() =>
      Promise.resolve(changeRoleCard(role, edit, withStored(context, role), new Date(), null)),
    );
    return [...new Set(reasons)];
  }

  /**
   * What a card is checked against now: what each engine type offers, the Roles a switch may consult, and who
   * holds Default Consultant for MCP tool hard switches.
   */
  private async cardContext(): Promise<RoleCardContext> {
    const [engines, roles, mcpConsultant] = await Promise.all([
      this.engineModels.engines(),
      this.repository.list(),
      this.duties.mcpConsultant(),
    ]);
    return {
      engineTypes: engineTypesOffered(engines),
      consultable: consultableRoleKeys(roles.map((role) => role.key)),
      mcpConsultant,
    };
  }

  /**
   * Saves the card with these words changed and nothing else, as `changeCard` does, as the person
   * filling `proposedBy` changed it on their own: no user saved it. The card is read under the same hold as the save, so a
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
        saved: await this.savedCard(key, edit, current.skills, null, proposedBy),
        skills: current.skills,
      };
    });
    return this.announcedWithSkills(saved, skills, null);
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
   * A person names no engine, so it isn't weighed against the engines (spec §5.4.5).
   */
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

/** `context` for a change of the card `stored` has now, whose engine settings stay acceptable. */
function withStored(context: RoleCardContext, stored: Role | undefined): RoleCardContext {
  return stored ? { ...context, storedEngineSettings: stored.card.engineSettings } : context;
}

/** A preset's title, else the title on the card of the Role hired from scratch under `key`. */
function consultableTitle(key: string, roles: readonly Role[]): string {
  return presetTitle(key) ?? roles.find((role) => role.key === key)?.card.title ?? key;
}
