import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Role, RoleCardVersion } from "../../domain/role.js";
import type { RoleChange } from "../../domain/role-changes.js";
import type {
  RoleAvatarChanged,
  RoleCardChanged,
  RoleHiredBack,
  RoleLetGo,
} from "../../domain/role-events.js";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { RoleRepository, type RoleUpdate } from "../../ports/role-repository.js";
import { roleCardVersions, roles } from "./roles.schema.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RoleRow = typeof roles.$inferSelect;
type RoleCardVersionRow = typeof roleCardVersions.$inferSelect;

/** A Role's row joined with its current card version. */
const currentCard = and(
  eq(roleCardVersions.roleKey, roles.key),
  eq(roleCardVersions.version, roles.cardVersion),
);

@Injectable()
export class PostgresRoleRepository extends RoleRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(role: Role): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const added = await transaction
        .insert(roles)
        .values(toRow(role))
        .onConflictDoNothing()
        .returning({ key: roles.key });
      if (added.length === 0) return false;
      await transaction
        .insert(roleCardVersions)
        .values({ ...currentVersionRow(role), changes: [] });
      return true;
    });
  }

  async find(key: string): Promise<Role | undefined> {
    const [row] = await this.database
      .select()
      .from(roles)
      .innerJoin(roleCardVersions, currentCard)
      .where(eq(roles.key, key));
    return row && toRole(row.roles, row.role_card_versions);
  }

  async list(): Promise<readonly Role[]> {
    const rows = await this.database
      .select()
      .from(roles)
      .innerJoin(roleCardVersions, currentCard)
      .orderBy(asc(roles.hiredAt), asc(roles.key));
    return rows.map((row) => toRole(row.roles, row.role_card_versions));
  }

  async update(
    key: string,
    change: (role: Role) => RoleChange<RoleCardChanged> | undefined,
  ): Promise<RoleUpdate> {
    return this.database.transaction(async (transaction) => {
      const role = await heldRole(transaction, key);
      const changed = change(role);
      if (!changed) return { role, event: undefined };
      await transaction.update(roles).set(toRow(changed.role)).where(eq(roles.key, key));
      await transaction
        .insert(roleCardVersions)
        .values({ ...currentVersionRow(changed.role), changes: [...changed.event.changes] });
      return changed;
    });
  }

  async changeStanding<Event extends RoleLetGo | RoleHiredBack>(
    key: string,
    change: (role: Role) => RoleChange<Event>,
  ): Promise<RoleChange<Event>> {
    return this.database.transaction(async (transaction) => {
      const changed = change(await heldRole(transaction, key));
      await transaction
        .update(roles)
        .set({ letGoAt: changed.role.letGoAt ?? null })
        .where(eq(roles.key, key));
      return changed;
    });
  }

  async changeAvatar(
    key: string,
    change: (role: Role) => RoleChange<RoleAvatarChanged> | undefined,
  ): Promise<RoleUpdate<RoleAvatarChanged>> {
    return this.database.transaction(async (transaction) => {
      const role = await heldRole(transaction, key);
      const changed = change(role);
      if (!changed) return { role, event: undefined };
      await transaction
        .update(roles)
        .set({ avatar: changed.role.avatar })
        .where(eq(roles.key, key));
      return changed;
    });
  }

  async version(key: string, version: number): Promise<RoleCardVersion | undefined> {
    const [row] = await this.database
      .select()
      .from(roleCardVersions)
      .where(and(eq(roleCardVersions.roleKey, key), eq(roleCardVersions.version, version)));
    return row && toVersion(row);
  }

  async versions(key: string): Promise<readonly RoleCardVersion[]> {
    const rows = await this.database
      .select()
      .from(roleCardVersions)
      .where(eq(roleCardVersions.roleKey, key))
      .orderBy(desc(roleCardVersions.version));
    return rows.map(toVersion);
  }
}

/** The Role as stored, locked until `transaction` ends. */
async function heldRole(transaction: Transaction, key: string): Promise<Role> {
  // Locked on its own: Postgres re-checks a locked row against a join after waiting for the lock,
  // and the version joined before the other change would no longer match.
  const [locked] = await transaction
    .select({ key: roles.key })
    .from(roles)
    .where(eq(roles.key, key))
    .for("update");
  if (!locked) throw new RoleNotFound(key);
  const [row] = await transaction
    .select()
    .from(roles)
    .innerJoin(roleCardVersions, currentCard)
    .where(eq(roles.key, key));
  if (!row) throw new RoleNotFound(key);
  return toRole(row.roles, row.role_card_versions);
}

function toRow(role: Role): RoleRow {
  return {
    key: role.key,
    cardVersion: role.cardVersion,
    hiredAt: role.hiredAt,
    letGoAt: role.letGoAt ?? null,
    avatar: role.avatar,
  };
}

function currentVersionRow(role: Role): Omit<RoleCardVersionRow, "changes"> {
  return {
    roleKey: role.key,
    version: role.cardVersion,
    card: role.card,
    savedAt: role.cardSavedAt,
    proposedBy: role.cardProposedBy ?? null,
  };
}

function toRole(row: RoleRow, version: RoleCardVersionRow): Role {
  return {
    key: row.key,
    card: version.card,
    cardVersion: row.cardVersion,
    hiredAt: row.hiredAt,
    cardSavedAt: version.savedAt,
    cardProposedBy: version.proposedBy ?? undefined,
    letGoAt: row.letGoAt ?? undefined,
    avatar: row.avatar,
  };
}

function toVersion(row: RoleCardVersionRow): RoleCardVersion {
  return {
    version: row.version,
    card: row.card,
    changes: row.changes,
    savedAt: row.savedAt,
    proposedBy: row.proposedBy ?? undefined,
  };
}
