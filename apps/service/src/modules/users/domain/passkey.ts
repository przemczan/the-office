/**
 * A key a user's device or password manager keeps for The Office at one address (spec §2.10),
 * added from their account; it signs them in alone. Only its public key is kept here.
 */
export interface Passkey {
  readonly id: string;
  readonly userId: string;
  /** The credential's id, base64url, as the browser names it when signing in. */
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  /** The authenticator's signature counter at the last use; synced passkeys always report 0. */
  readonly counter: number;
  readonly transports: readonly string[];
  readonly name: string;
  /** The address it was added at, its relying party: `localhost` or the public hostname. */
  readonly rpId: string;
  /** Whether it lives on one device only or is synced between a user's devices. */
  readonly deviceType: "single-device" | "multi-device";
  readonly backedUp: boolean;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | undefined;
}

/** A passkey as a ceremony checked it, before the user's name for it is added. */
export interface NewCredential {
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly transports: readonly string[];
  readonly deviceType: Passkey["deviceType"];
  readonly backedUp: boolean;
}

/** The longest name a passkey takes (spec §2.10 Defaults). */
export const PASSKEY_NAME_MAX_LENGTH = 60;

/** Why a passkey's name is refused, in the UI's words; none when it is taken. */
export function passkeyNameProblems(name: string): string[] {
  const trimmed = name.trim();
  if (trimmed === "") return ["Give the passkey a name."];
  if (trimmed.length > PASSKEY_NAME_MAX_LENGTH) {
    return [`A passkey's name has at most ${PASSKEY_NAME_MAX_LENGTH} characters.`];
  }
  return [];
}

export function passkeyOf(
  id: string,
  userId: string,
  name: string,
  rpId: string,
  credential: NewCredential,
  now: Date,
): Passkey {
  return {
    id,
    userId,
    ...credential,
    name: name.trim(),
    rpId,
    createdAt: now,
    lastUsedAt: undefined,
  };
}

export function renamed(passkey: Passkey, name: string): Passkey {
  return { ...passkey, name: name.trim() };
}

export function usedAt(passkey: Passkey, counter: number, now: Date): Passkey {
  return { ...passkey, counter, lastUsedAt: now };
}

/**
 * Whether a sign-in's counter says the passkey may have been copied: it must go up whenever either
 * counter isn't 0, as WebAuthn's rule is; synced passkeys report 0 every time, which is fine.
 */
export function isPossibleClone(stored: number, reported: number): boolean {
  return (stored > 0 || reported > 0) && reported <= stored;
}

/**
 * The user handle a passkey is made with and answers with when signing in: the user's id, as
 * bytes, in base64url, so it names no email.
 */
export function userHandleOf(userId: string): string {
  return Buffer.from(userId, "utf8").toString("base64url");
}
