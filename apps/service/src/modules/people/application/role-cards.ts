import { Injectable } from "@nestjs/common";
import { KNOWN_ROLES } from "../domain/known-roles.js";
import type { RoleCard } from "../domain/role-card.js";
import { RoleCardVersionNotFound } from "../domain/role-card-version-not-found.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRepository } from "../ports/role-repository.js";

/** The card a session of the Role runs with, at the version it records. */
export interface SessionRole {
  readonly roleKey: string;
  readonly cardVersion: number;
  readonly card: RoleCard;
}

/**
 * The Role cards for the modules that start sessions (spec §2.2): a new session gets the current
 * version and records it; a resumed one is given the version it recorded, so a change reaches only
 * sessions started after it.
 */
@Injectable()
export class RoleCards {
  constructor(private readonly repository: RoleRepository) {}

  /** Throws RoleNotFound when nobody fills the Role. */
  async forNewSession(roleKey: string): Promise<SessionRole> {
    const role = await this.find(roleKey);
    if (!role) throw new RoleNotFound(roleKey);
    return role;
  }

  /** The card a new session would start with, or undefined when nobody fills the Role. */
  async find(roleKey: string): Promise<SessionRole | undefined> {
    const role = await this.repository.find(roleKey);
    return role && !role.letGoAt
      ? { roleKey, cardVersion: role.cardVersion, card: role.card }
      : undefined;
  }

  /** The person who filled the Role before they were let go; undefined when nobody ever did. */
  async findLetGo(roleKey: string): Promise<{ readonly name: string } | undefined> {
    const role = await this.repository.find(roleKey);
    return role?.letGoAt ? { name: role.card.name } : undefined;
  }

  /**
   * The Role's preset title, as the Role card names a Role to consult; the key itself for a Role
   * The Office doesn't know, which no saved card names.
   */
  roleTitle(roleKey: string): string {
    return KNOWN_ROLES.get(roleKey) ?? roleKey;
  }

  /**
   * Throws RoleNotFound when nobody fills the Role, so a person let go never resumes a session, and
   * RoleCardVersionNotFound when the Role has no such version.
   */
  async forResumedSession(roleKey: string, cardVersion: number): Promise<SessionRole> {
    if (!(await this.find(roleKey))) throw new RoleNotFound(roleKey);
    const version = await this.repository.version(roleKey, cardVersion);
    if (!version) throw new RoleCardVersionNotFound(roleKey, cardVersion);
    return { roleKey, cardVersion, card: version.card };
  }
}
