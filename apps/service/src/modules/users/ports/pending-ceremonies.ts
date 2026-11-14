import type { PendingCeremony } from "../domain/pending-ceremony.js";

/**
 * The passkey ceremonies started and not yet answered, each under a key the caller chose. Kept
 * server-side, a number of them at most, since starting a sign-in needs no sign-in, and each
 * taken once.
 */
export abstract class PendingCeremonies {
  /** Keeps the ceremony under the key, in place of one kept there before. */
  abstract keep(key: string, ceremony: PendingCeremony, now: Date): void;

  /** The ceremony kept under the key, forgotten as it is taken, expired or not. */
  abstract take(key: string): PendingCeremony | undefined;
}
