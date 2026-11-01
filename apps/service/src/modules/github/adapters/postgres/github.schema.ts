import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/** The GitHub App behind Sign in with GitHub, in one row once registered. */
export const githubApp = pgTable(
  "github_app",
  {
    id: smallint("id").primaryKey().default(1),
    clientId: text("client_id").notNull(),
    /** Never sent to the web, as an API key isn't. */
    clientSecret: text("client_secret").notNull(),
    slug: text("slug").notNull(),
    owner: text("owner").notNull(),
  },
  (table) => [check("github_app_one_row", sql`${table.id} = 1`)],
);

/**
 * Sign in with GitHub, in one row: who is signed in with which tokens, or why The Office signed
 * the user out. The tokens are never sent to the web. No row: signed out by the user.
 */
export const githubSignIn = pgTable(
  "github_sign_in",
  {
    id: smallint("id").primaryKey().default(1),
    login: text("login"),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    signedOutReason: text("signed_out_reason"),
  },
  (table) => [
    check("github_sign_in_one_row", sql`${table.id} = 1`),
    check(
      "github_sign_in_signed_in_or_out",
      sql`(${table.login} is not null and ${table.accessToken} is not null and ${table.signedOutReason} is null)
        or (${table.login} is null and ${table.accessToken} is null and ${table.refreshToken} is null
          and ${table.signedOutReason} is not null)`,
    ),
  ],
);
