import { Injectable } from "@nestjs/common";
import type { DutyKey } from "../domain/duties.js";
import type { HardSwitchValue } from "../domain/hard-switches.js";
import {
  permissionNarrowingProblems,
  type PermissionNarrowing,
} from "../domain/permission-profile.js";
import { consultableRoleKeys, presetTitle } from "../domain/presets.js";
import type { RoleCard } from "../domain/role-card.js";
import { RoleCardVersionNotFound } from "../domain/role-card-version-not-found.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRepository } from "../ports/role-repository.js";
import { Duties } from "./duties.js";

/**
 * The card a session of the Role runs with, at the version it records, with where its MCP tools the
 * card leaves unset stand, as read now.
 */
export interface SessionRole {
  readonly roleKey: string;
  readonly cardVersion: number;
  readonly card: RoleCard;
  readonly mcpToolDefault: HardSwitchValue;
}

/** A hired person other people may consult (spec §2.2): their Consultant capability is on. */
export interface Consultant {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
}

/**
 * The Role cards for the modules that start sessions (spec §2.2): a new session gets the current
 * version and records it; a resumed one is given the version it recorded, so a change reaches only
 * sessions started after it.
 */
@Injectable()
export class RoleCards {
  constructor(
    private readonly repository: RoleRepository,
    private readonly duties: Duties,
  ) {}

  /** Throws RoleNotFound when nobody fills the Role. */
  async forNewSession(roleKey: string): Promise<SessionRole> {
    const role = await this.find(roleKey);
    if (!role) throw new RoleNotFound(roleKey);
    return role;
  }

  /** The card a new session would start with, or undefined when nobody fills the Role. */
  async find(roleKey: string): Promise<SessionRole | undefined> {
    const role = await this.repository.find(roleKey);
    if (!role || role.letGoAt) return undefined;
    return {
      roleKey,
      cardVersion: role.cardVersion,
      card: role.card,
      mcpToolDefault: await this.duties.mcpToolDefault(),
    };
  }

  /** The keys of the Roles someone fills now. */
  async hiredKeys(): Promise<ReadonlySet<string>> {
    const roles = await this.repository.list();
    return new Set(roles.filter((role) => !role.letGoAt).map((role) => role.key));
  }

  /** The people hired now whose Consultant capability is on. */
  async consultants(): Promise<readonly Consultant[]> {
    const roles = await this.repository.list();
    return roles
      .filter((role) => !role.letGoAt && role.card.capabilities.consultant)
      .map(({ key, card }) => ({ roleKey: key, name: card.name, title: card.title }));
  }

  /** The person who filled the Role before they were let go; undefined when nobody ever did. */
  async findLetGo(roleKey: string): Promise<{ readonly name: string } | undefined> {
    const role = await this.repository.find(roleKey);
    return role?.letGoAt ? { name: role.card.name } : undefined;
  }

  /** The key of the hired Role holding `duty`; undefined while nobody does. */
  holderOf(duty: DutyKey): Promise<string | undefined> {
    return this.duties.holderOf(duty);
  }

  /** The key of the Role `duty` names, hired or not; undefined while it is set to none. */
  dutyRoleKey(duty: DutyKey): Promise<string | undefined> {
    return this.duties.roleKeyOf(duty);
  }

  /** Where an MCP tool stands until the user sets it. */
  mcpToolDefault(): Promise<HardSwitchValue> {
    return this.duties.mcpToolDefault();
  }

  /**
   * Why a Stage's narrowing of the Role's profile can't stand, in the UI's words; empty when it
   * can, or when nobody fills the Role.
   */
  async permissionNarrowingProblems(
    roleKey: string,
    narrowing: PermissionNarrowing,
  ): Promise<string[]> {
    const person = await this.find(roleKey);
    if (!person) return [];
    const roles = await this.repository.list();
    return permissionNarrowingProblems(roleKey, person.card.permissionProfile, narrowing, {
      consultable: consultableRoleKeys(roles.map((role) => role.key)),
      mcpConsultant: await this.duties.mcpConsultant(),
    });
  }

  /**
   * The Role's preset title, as the Role card names a Role to consult; the key itself for a Role no
   * preset has.
   */
  roleTitle(roleKey: string): string {
    return presetTitle(roleKey) ?? roleKey;
  }

  /**
   * Throws RoleNotFound when nobody fills the Role, so a person let go never resumes a session, and
   * RoleCardVersionNotFound when the Role has no such version.
   */
  async forResumedSession(roleKey: string, cardVersion: number): Promise<SessionRole> {
    if (!(await this.find(roleKey))) throw new RoleNotFound(roleKey);
    const version = await this.repository.version(roleKey, cardVersion);
    if (!version) throw new RoleCardVersionNotFound(roleKey, cardVersion);
    return {
      roleKey,
      cardVersion,
      card: version.card,
      mcpToolDefault: await this.duties.mcpToolDefault(),
    };
  }
}
