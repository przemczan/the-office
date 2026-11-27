import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { Avatar } from "../../domain/avatar.js";
import type { Authority } from "../../domain/authority.js";
import type { HardSwitches, HardSwitchValue } from "../../domain/hard-switches.js";
import type { PersonEngineSettings, RoleCard } from "../../domain/role-card.js";
import type { EarlierEngineFields } from "../../domain/role-changes.js";
import type { RoleCardFieldChange } from "../../domain/role-card-changes.js";
import type { UserRef } from "../../domain/user.js";

/** Each Role someone fills, with the version of its card sessions start with now. */
export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  cardVersion: integer("card_version").notNull(),
  hiredAt: timestamp("hired_at", { withTimezone: true }).notNull(),
  /** Null while the person fills the Role. */
  letGoAt: timestamp("let_go_at", { withTimezone: true }),
  /** Null while the person has none. */
  avatar: jsonb("avatar").$type<Avatar>(),
  /**
   * Whether the second Authority move-over has given the Role its duties' jobs (spec §2.2, "Duty"),
   * so it runs once per Role: false on every Role hired before it, true on every Role hired after,
   * whose hire gives them. A card change never sets it.
   */
  dutyJobsGiven: boolean("duty_jobs_given").notNull().default(false),
});

/**
 * A card as kept: a version saved before `engineSettings` lacks it until the move-over gives the
 * Role a version with it, and every version keeps the earlier fields for a rollback to read. A
 * version the release before Change Project settings saved after a rollback lacks that switch.
 * `hardSwitches` is written on every save, in step with `authority` (`hardSwitchesOf`), as the
 * release before Authority reads them; a version it saved lacks `authority` until the Authority
 * move-over gives the Role a version with it, and reads its Authority from its Hard switches.
 */
export type StoredRoleCard = Omit<RoleCard, "engineSettings" | "authority"> & {
  readonly engineSettings?: PersonEngineSettings;
  readonly authority?: Authority;
  readonly hardSwitches: Omit<HardSwitches, "changeProjectSettings"> & {
    readonly changeProjectSettings?: HardSwitchValue;
  };
} & EarlierEngineFields;

/** Every version of each Role's card, kept for the sessions that started with it. */
export const roleCardVersions = pgTable(
  "role_card_versions",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    card: jsonb("card").$type<StoredRoleCard>().notNull(),
    /** From the version before; empty for the first. */
    changes: jsonb("changes").$type<RoleCardFieldChange[]>().notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    /** Who proposed the version, by the key of their Role; null when the user wrote it. */
    proposedBy: text("proposed_by"),
    /**
     * The user who saved the version, hired the person or applied the Proposal of it. SQL null when
     * no user did (an Agent's `change_role`, an engine's removal); jsonb null on a version from
     * before users existed, until the first user claims it (`PeopleEarlierRecords`).
     */
    savedBy: jsonb("saved_by").$type<UserRef | null>(),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.version] })],
);
