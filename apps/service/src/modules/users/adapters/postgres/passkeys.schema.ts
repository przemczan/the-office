import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { Passkey } from "../../domain/passkey.js";
import { users } from "./users.schema.js";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/**
 * Each user's passkeys: the credential's id and public key, never anything that signs in from a
 * copy of the database, its counter, the address it was added at (its rp id) and when it was last
 * used. Removing a user deletes theirs on `UserRemoved`, as their row stays.
 */
export const passkeys = pgTable(
  "passkeys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** base64url, as browsers name it. */
    credentialId: text("credential_id").notNull().unique(),
    publicKey: bytea("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull(),
    transports: text("transports").array().notNull(),
    name: text("name").notNull(),
    rpId: text("rp_id").notNull(),
    deviceType: text("device_type").$type<Passkey["deviceType"]>().notNull(),
    backedUp: boolean("backed_up").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("passkeys_user").on(table.userId),
    check("passkeys_device_type", sql`${table.deviceType} IN ('single-device', 'multi-device')`),
  ],
);
