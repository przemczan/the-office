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
 * Each user's authenticator: its secret in base32, readable since codes are checked against it (a
 * copy of the database holds all The Office's data anyway), confirmed once a first code was right,
 * and the last time step whose code was taken.
 */
export const authenticators = pgTable("authenticators", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  lastUsedStep: integer("last_used_step"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Each user's recovery codes, as SHA-256 hashes only, each used once. */
export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("recovery_codes_user_code").on(table.userId, table.codeHash)],
);

/** Each sign-in waiting for an authenticator code: its token's SHA-256 only, until it expires. */
export const pendingSignIns = pgTable(
  "pending_sign_ins",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("pending_sign_ins_user").on(table.userId)],
);
