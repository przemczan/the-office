import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AddressKind } from "../../domain/address-kind.js";

/**
 * Each user, with their password's scrypt hash, never the password, and their wrong tries in a
 * row, kept here so a restart doesn't reset the slow-down or the lockout.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    wrongTriesInARow: integer("wrong_tries_in_a_row").notNull().default(0),
    nextTryAt: timestamp("next_try_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("users_email_unique").on(sql`lower(${table.email})`)],
);

/**
 * Each signed-in device: its sign-in token's SHA-256, never the token, the browser it came from and
 * the kind of address it signed in at. A user's removal takes their devices along.
 */
export const signedInDevices = pgTable(
  "signed_in_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    addressKind: text("address_kind").$type<AddressKind>().notNull(),
    signedInAt: timestamp("signed_in_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("signed_in_devices_user").on(table.userId),
    check(
      "signed_in_devices_address_kind",
      sql`${table.addressKind} IN ('localhost', 'loopback-ip', 'local-network-ip', 'public')`,
    ),
  ],
);

/**
 * When every module's records made before users existed were given the first user (one row at
 * most): until it is written, each start claims them again.
 */
export const earlierRecordsClaimed = pgTable(
  "earlier_records_claimed",
  {
    id: integer("id").primaryKey().default(1),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull(),
  },
  (table) => [check("earlier_records_claimed_one_row", sql`${table.id} = 1`)],
);
