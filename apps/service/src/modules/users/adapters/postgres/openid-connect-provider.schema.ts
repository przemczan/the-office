import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The OpenID Connect provider Continue with <name> signs in through, in one row once saved, with
 * the endpoints its discovery document named when it was saved. The secret is kept as entered,
 * since it is sent to the token endpoint, and is never sent to the web. Removing it clears the
 * secret and sets `removed_at`, keeping the issuer, so a provider saved later at another issuer
 * still unlinks this one's identities.
 */
export const openIdConnectProvider = pgTable(
  "openid_connect_provider",
  {
    id: smallint("id").primaryKey().default(1),
    name: text("name").notNull(),
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    authorizationEndpoint: text("authorization_endpoint").notNull(),
    tokenEndpoint: text("token_endpoint").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (table) => [check("openid_connect_provider_one_row", sql`${table.id} = 1`)],
);
