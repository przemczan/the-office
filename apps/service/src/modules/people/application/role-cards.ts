import { Injectable } from "@nestjs/common";
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
    const role = await this.repository.find(roleKey);
    if (!role) throw new RoleNotFound(roleKey);
    return { roleKey, cardVersion: role.cardVersion, card: role.card };
  }

  /** Throws RoleCardVersionNotFound when the Role has no such version. */
  async forResumedSession(roleKey: string, cardVersion: number): Promise<SessionRole> {
    const version = await this.repository.version(roleKey, cardVersion);
    if (!version) throw new RoleCardVersionNotFound(roleKey, cardVersion);
    return { roleKey, cardVersion, card: version.card };
  }
}
