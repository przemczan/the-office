import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import {
  authorityWithHardSwitches,
  hardSwitchesOf,
  isAuthorityGroup,
  RETIRED_AUTHORITY_GROUPS,
  withoutRetiredRows,
} from "../../domain/authority.js";
import { ASK_ME, type HardSwitches } from "../../domain/hard-switches.js";
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
/** A Role's row as a save writes it: whether its duties' jobs were given is set apart. */
type RoleRowSaved = Omit<RoleRow, "dutyJobsGiven">;
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

  rolesToMoveAuthorityOver(): Promise<readonly string[]> {
    return readOnce(readKey("roles.toMoveAuthorityOver"), async () => {
      const rows = await this.database
        .select({ key: roles.key })
        .from(roles)
        .innerJoin(roleCardVersions, currentCard)
        .where(sql`${roleCardVersions.card} -> 'authority' is null`)
        .orderBy(asc(roles.hiredAt), asc(roles.key));
      return rows.map((row) => row.key);
    });
  }

  async moveAuthorityOver(
    key: string,
    change: (role: Role, switches: HardSwitches) => RoleChange<RoleCardChanged>,
  ): Promise<RoleUpdate> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const { role, stored } = await heldRole(transaction, key);
        // Moved over meanwhile, by another start of the service.
        if (stored.authority !== undefined) return { role, event: undefined };
        const changed = change(role, {
          ...stored.hardSwitches,
          changeProjectSettings: stored.hardSwitches.changeProjectSettings ?? ASK_ME,
        });
        await saveVersion(transaction, changed, earlierFieldsOf(stored), {
          engineSettingsMissing: stored.engineSettings === undefined,
        });
        return changed;
      }),
    );
  }

  rolesToGiveDutiesJobs(): Promise<readonly string[]> {
    return readOnce(readKey("roles.toGiveDutiesJobs"), async () => {
      const rows = await this.database
        .select({ key: roles.key })
        .from(roles)
        .where(eq(roles.dutyJobsGiven, false))
        .orderBy(asc(roles.hiredAt), asc(roles.key));
      return rows.map((row) => row.key);
    });
  }

  async giveDutiesJobs(
    key: string,
    change: (role: Role) => RoleChange<RoleCardChanged> | undefined,
  ): Promise<RoleUpdate> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const { role, stored, dutyJobsGiven } = await heldRole(transaction, key);
        // Given meanwhile, by another start of the service.
        if (dutyJobsGiven) return { role, event: undefined };
        const changed = change(role);
        if (changed) await saveVersion(transaction, changed, earlierFieldsOf(stored));
        await transaction.update(roles).set({ dutyJobsGiven: true }).where(eq(roles.key, key));
        return changed ?? { role, event: undefined };
      }),
    );
  }

  rolesWithRetiredProposalRows(): Promise<readonly string[]> {
    return readOnce(readKey("roles.withRetiredProposalRows"), async () => {
      const rows = await this.database
        .select({ key: roles.key })
        .from(roles)
        .innerJoin(roleCardVersions, currentCard)
        .where(sql`${hasRetiredProposalRow(roleCardVersions.card)}`)
        .orderBy(asc(roles.hiredAt), asc(roles.key));
      return rows.map((row) => row.key);
    });
  }

  async moveProjectSettingProposalsOver(
    key: string,
    change: (role: Role) => RoleChange<RoleCardChanged> | undefined,
  ): Promise<RoleUpdate> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const { role, stored } = await heldRole(transaction, key);
        // Moved over meanwhile, by another start of the service.
        if (!holdsRetiredProposalRow(stored)) return { role, event: undefined };
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
        // The Authority move-over, apart, still finds the card without one, and its switches as kept.
        await saveVersion(
          transaction,
          changed,
          earlier,
          stored.authority === undefined ? { authorityMissing: stored.hardSwitches } : {},
        );
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
  // Its hire gave it its duties' jobs, so the second Authority move-over leaves it.
  const added = await transaction
    .insert(roles)
    .values({ ...toRow(role), dutyJobsGiven: true })
    .onConflictDoNothing()
    .returning({ key: roles.key });
  if (added.length === 0) return false;
  await transaction
    .insert(roleCardVersions)
    .values({ ...currentVersionRow(role, HIRED_EARLIER), changes: [] });
  return true;
}

/**
 * What a move-over keeps missing from the card it saves, so the other move-over, which runs apart,
 * still finds it to move: `engineSettings`, or `authority` with the Hard switches as kept.
 */
interface StillMissing {
  readonly engineSettingsMissing?: boolean;
  readonly authorityMissing?: StoredRoleCard["hardSwitches"];
}

/** Saves the changed Role's row and its card's new version, keeping the `earlier` fields. */
async function saveVersion(
  transaction: Transaction,
  { role, event }: RoleChange<RoleCardChanged>,
  earlier: EarlierEngineFields,
  missing: StillMissing = {},
): Promise<void> {
  await transaction.update(roles).set(toRow(role)).where(eq(roles.key, role.key));
  await transaction
    .insert(roleCardVersions)
    .values({ ...currentVersionRow(role, earlier, missing), changes: [...event.changes] });
}

/** Whether a stored card keeps a retired tool's row at Proposal (spec 5.4.1, "Per-kind Proposal tools fold in"). */
function holdsRetiredProposalRow({ authority }: StoredRoleCard): boolean {
  const rows: Readonly<Record<string, { readonly kind?: string } | undefined>> = authority ?? {};
  return RETIRED_AUTHORITY_GROUPS.some((group) => rows[group]?.kind === "proposal");
}

/** SQL for `holdsRetiredProposalRow` on a card column. */
function hasRetiredProposalRow(card: typeof roleCardVersions.card) {
  return sql.join(
    RETIRED_AUTHORITY_GROUPS.map(
      (group) => sql`(${card} -> 'authority' -> ${group} ->> 'kind') = 'proposal'`,
    ),
    sql` or `,
  );
}

/** The Role as stored, with its current card as kept, locked until `transaction` ends. */
async function heldRole(
  transaction: Transaction,
  key: string,
): Promise<{
  readonly role: Role;
  readonly stored: StoredRoleCard;
  readonly dutyJobsGiven: boolean;
}> {
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
  return {
    role: toRole(row.roles, row.role_card_versions),
    stored: row.role_card_versions.card,
    dutyJobsGiven: row.roles.dutyJobsGiven,
  };
}

function toRow(role: Role): RoleRowSaved {
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
 * release before finds them as they were (spec §5.4.5, "Moving the earlier engine settings over"),
 * and the Hard switches in step with the Authority, as the release before Authority reads them.
 */
function currentVersionRow(
  role: Role,
  earlier: EarlierEngineFields,
  missing: StillMissing = {},
): Omit<RoleCardVersionRow, "changes"> {
  return {
    roleKey: role.key,
    version: role.cardVersion,
    card: storedCardOf(role, earlier, missing),
    savedAt: role.cardSavedAt,
    proposedBy: role.cardProposedBy ?? null,
    savedBy: role.cardSavedBy,
  };
}

function storedCardOf(
  { key, card }: Role,
  earlier: EarlierEngineFields,
  { engineSettingsMissing = false, authorityMissing }: StillMissing,
): StoredRoleCard {
  const { authority, engineSettings, ...rest } = card;
  return {
    ...rest,
    ...(!engineSettingsMissing && { engineSettings }),
    ...(authorityMissing
      ? { hardSwitches: authorityMissing }
      : { authority, hardSwitches: hardSwitchesOf(key, authority) }),
    ...earlier,
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
 * and its Authority with its Hard switches over it (`authorityWithHardSwitches`).
 *
 * A card the release before Authority saved has Hard switches only, whose values that differ from
 * the preset's defaults are set rows; one it saved after a rollback lost `authority` through its own
 * request schema, or changed switches the Authority doesn't say, and reads the same way. Migration
 * 0212 gave every stored card Change Project settings, but the release before it drops the switch on
 * any save after a rollback: a missing one reads as Ask me, as a Role hired from scratch starts. The
 * Caretaker's reads as its fixed Authority, whatever it keeps.
 */
function cardOf(
  roleKey: string,
  {
    roleOverride: _roleOverride,
    effort: _effort,
    hardSwitches,
    authority,
    ...card
  }: StoredRoleCard,
): RoleCard {
  return {
    ...card,
    engineSettings: card.engineSettings ?? {},
    authority: authorityWithHardSwitches(
      roleKey,
      withoutRetiredRows(authority ?? {}),
      hardSwitches,
    ),
  };
}

function toRole(row: RoleRowSaved, version: RoleCardVersionRow): Role {
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

/**
 * Whether a change of the card's history names a field the catalog has: a row of a retired tool
 * (`authority.proposeActions`) is left out, as the contract's field names no longer hold it.
 */
function inTheCatalog({ field }: { readonly field: string }): boolean {
  return !field.startsWith("authority.") || isAuthorityGroup(field.slice("authority.".length));
}

function toVersion(row: RoleCardVersionRow): RoleCardVersion {
  return {
    version: row.version,
    card: cardOf(row.roleKey, row.card),
    changes: row.changes.filter(inTheCatalog),
    savedAt: row.savedAt,
    proposedBy: row.proposedBy ?? undefined,
    savedBy: row.savedBy,
  };
}
