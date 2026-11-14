import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

/** A new sign-in token: 32 random bytes, as the cookie carries them. */
export function newSignInToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * The token as kept (spec §6): its SHA-256, which, the token being random, signs nobody in from a
 * copy of the database.
 */
export function tokenHashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
