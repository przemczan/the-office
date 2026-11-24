import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import { CARETAKER_FIXED_PARTS, isBuiltIn } from "../../domain/caretaker.js";
import { ASK_ME, type HardSwitchValue } from "../../domain/hard-switches.js";
import type { Role, RoleCardVersion } from "../../domain/role.js";
import type { RoleCard } from "../../domain/role-card.js";
import type { EarlierEngineFields, RoleChange } from "../../domain/role-changes.js";
import type {
  RoleAvatarChanged,
  RoleCardChanged,
  RoleHiredBack,
  RoleLetGo,
} from "../../domain/role-events.js";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { RoleRepository, type RoleUpdate } from "../../ports/role-repository.js";
import { roleCardVersions, roles, type StoredRoleCard } from "./roles.schema.js";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type RoleRow = typeof roles.$inferSelect;
type RoleCardVersionRow = typeof roleCardVersions.$inferSelect;

/**
 * The earlier fields a new hire's card keeps, as the release before would have saved it: no Role
 * override and its default effort.
 */
const HIRED_EARLIER: Required<EarlierEngineFields> = { roleOverride: null, effort: "high" };

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
    return forgettingReads(() =>
      this.database.transaction((transaction) => addRole(transaction, role)),
    );
  }

  find(key: string): Promise<Role | undefined> {
    return readOnce(readKey("roles.find", key), async () => {
      const [row] = await this.database
        .select()
        .from(roles)
        .innerJoin(roleCardVersions, currentCard)
        .where(eq(roles.key, key));
      return row && toRole(row.roles, row.role_card_versions);
    });
  }

  list(): Promise<readonly Role[]> {
    return readOnce(readKey("roles.list"), async () => {
      const rows = await this.database
        .select()
        .from(roles)
        .innerJoin(roleCardVersions, currentCard)
        .orderBy(asc(roles.hiredAt), asc(roles.key));
      return rows.map((row) => toRole(row.roles, row.role_card_versions));
    });
  }

  async update(
    key: string,
    change: (role: Role) => RoleChange<RoleCardChanged> | undefined,
  ): Promise<RoleUpdate> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const { role, stored } = await heldRole(transaction, key);
        const changed = change(role);
        if (!changed) return { role, event: undefined };
        await saveVersion(transaction, changed, earlierFieldsOf(stored));
        return changed;
      }),
    );
  }

  rolesToMoveOver(): Promise<readonly string[]> {
    return readOnce(readKey("roles.toMoveOver"), async () => {
      const rows = await this.database
        .select({ key: roles.key })
        .from(roles)
        .innerJoin(roleCardVersions, currentCard)
        .where(sql`${roleCardVersions.card} -> 'engineSettings' is null`)
        .orderBy(asc(roles.hiredAt), asc(roles.key));
      return rows.map((row) => row.key);
    });
  }

  async moveOver(
    key: string,
    change: (role: Role, earlier: EarlierEngineFields) => RoleChange<RoleCardChanged>,
  ): Promise<RoleUpdate> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const { role, stored } = await heldRole(transaction, key);
        // Moved over meanwhile, by another start of the service.
        if (stored.engineSettings !== undefined) return { role, event: undefined };
        const earlier = earlierFieldsOf(stored);
        const changed = change(role, earlier);
        await saveVersion(transaction, changed, earlier);
        return changed;
      }),
    );
  }

  async changeStanding<Event extends RoleLetGo | RoleHiredBack>(
    key: string,
    change: (role: Role) => RoleChange<Event>,
  ): Promise<RoleChange<Event>> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const changed = change((await heldRole(transaction, key)).role);
        await transaction
          .update(roles)
          .set({ letGoAt: changed.role.letGoAt ?? null })
          .where(eq(roles.key, key));
        return changed;
      }),
    );
  }

  async changeAvatar(
    key: string,
    change: (role: Role) => RoleChange<RoleAvatarChanged> | undefined,
  ): Promise<RoleUpdate<RoleAvatarChanged>> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const { role } = await heldRole(transaction, key);
        const changed = change(role);
        if (!changed) return { role, event: undefined };
        await transaction
          .update(roles)
          .set({ avatar: changed.role.avatar })
          .where(eq(roles.key, key));
        return changed;
      }),
    );
  }

  version(key: string, version: number): Promise<RoleCardVersion | undefined> {
    return readOnce(readKey("roles.version", key, version), async () => {
      const [row] = await this.database
        .select()
        .from(roleCardVersions)
        .where(and(eq(roleCardVersions.roleKey, key), eq(roleCardVersions.version, version)));
      return row && toVersion(row);
    });
  }

  versions(key: string): Promise<readonly RoleCardVersion[]> {
    return readOnce(readKey("roles.versions", key), async () => {
      const rows = await this.database
        .select()
        .from(roleCardVersions)
        .where(eq(roleCardVersions.roleKey, key))
        .orderBy(desc(roleCardVersions.version));
      return rows.map(toVersion);
    });
  }
}

/**
 * Keeps a newly hired Role with its card as version 1 inside `transaction`; false, adding nothing,
 * when someone already fills the Role.
 */
export async function addRole(transaction: Transaction, role: Role): Promise<boolean> {
  const added = await transaction
    .insert(roles)
    .values(toRow(role))
    .onConflictDoNothing()
    .returning({ key: roles.key });
  if (added.length === 0) return false;
  await transaction
    .insert(roleCardVersions)
    .values({ ...currentVersionRow(role, HIRED_EARLIER), changes: [] });
  return true;
}

/** Saves the changed Role's row and its card's new version, keeping the `earlier` fields. */
async function saveVersion(
  transaction: Transaction,
  { role, event }: RoleChange<RoleCardChanged>,
  earlier: EarlierEngineFields,
): Promise<void> {
  await transaction.update(roles).set(toRow(role)).where(eq(roles.key, role.key));
  await transaction
    .insert(roleCardVersions)
    .values({ ...currentVersionRow(role, earlier), changes: [...event.changes] });
}

/** The Role as stored, with its current card as kept, locked until `transaction` ends. */
async function heldRole(
  transaction: Transaction,
  key: string,
): Promise<{ readonly role: Role; readonly stored: StoredRoleCard }> {
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
  return { role: toRole(row.roles, row.role_card_versions), stored: row.role_card_versions.card };
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

/**
 * The Role's current card version as kept, carrying `earlier` forward unread so a rollback to the
 * release before finds them as they were (spec §5.4.5, "Moving the earlier engine settings over").
 */
function currentVersionRow(
  role: Role,
  earlier: EarlierEngineFields,
): Omit<RoleCardVersionRow, "changes"> {
  return {
    roleKey: role.key,
    version: role.cardVersion,
    card: { ...role.card, ...earlier },
    savedAt: role.cardSavedAt,
    proposedBy: role.cardProposedBy ?? null,
    savedBy: role.cardSavedBy,
  };
}

/** The earlier fields a kept card has, none on a card saved without them. */
function earlierFieldsOf({ roleOverride, effort }: StoredRoleCard): EarlierEngineFields {
  return {
    ...(roleOverride !== undefined && { roleOverride }),
    ...(effort !== undefined && { effort }),
  };
}

/**
 * The card as the domain reads it: the earlier fields left out, no engine settings read as none,
 * and no Change Project settings read as Ask me.
 *
 * Migration 0212 gave every stored card Change Project settings, but the release before reads a
 * card through its own request schema, which drops the switch it doesn't know: a card it saves
 * after a rollback lacks it. Such a card asks the user, as a Role hired from scratch starts; the
 * Caretaker's stays at its fixed Never, so its next save isn't refused for a fixed part changed.
 */
function cardOf(
  roleKey: string,
  { roleOverride: _roleOverride, effort: _effort, ...card }: StoredRoleCard,
): RoleCard {
  const { changeProjectSettings, ...hardSwitches } = card.hardSwitches;
  return {
    ...card,
    engineSettings: card.engineSettings ?? {},
    hardSwitches: {
      ...hardSwitches,
      changeProjectSettings: changeProjectSettings ?? changeProjectSettingsMissing(roleKey),
    },
  };
}

function changeProjectSettingsMissing(roleKey: string): HardSwitchValue {
  return isBuiltIn(roleKey) ? CARETAKER_FIXED_PARTS.hardSwitches.changeProjectSettings : ASK_ME;
}

function toRole(row: RoleRow, version: RoleCardVersionRow): Role {
  return {
    key: row.key,
    card: cardOf(row.key, version.card),
    cardVersion: row.cardVersion,
    hiredAt: row.hiredAt,
    cardSavedAt: version.savedAt,
    cardProposedBy: version.proposedBy ?? undefined,
    cardSavedBy: version.savedBy,
    letGoAt: row.letGoAt ?? undefined,
    avatar: row.avatar,
  };
}

function toVersion(row: RoleCardVersionRow): RoleCardVersion {
  return {
    version: row.version,
    card: cardOf(row.roleKey, row.card),
    changes: row.changes,
    savedAt: row.savedAt,
    proposedBy: row.proposedBy ?? undefined,
    savedBy: row.savedBy,
  };
}
