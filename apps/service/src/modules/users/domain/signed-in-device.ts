import type { AddressKind } from "./address-kind.js";

/**
 * A browser a user signed in from (spec §2.10), kept with its sign-in token's SHA-256 and never the
 * token. Never called a session.
 */
export interface SignedInDevice {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  /** The browser it came from, as its User-Agent said. */
  readonly userAgent: string | undefined;
  readonly addressKind: AddressKind;
  readonly signedInAt: Date;
  readonly lastSeenAt: Date;
  /** When it stops being signed in unless used again before. */
  readonly expiresAt: Date;
}

/** What a sign-in tells of the device it came from. */
export interface SignInRequest {
  readonly userAgent: string | undefined;
  readonly addressKind: AddressKind;
}

/** A device stays signed in 30 days after its last use (spec §2.10 Defaults). */
const SIGNED_IN_FOR_MS = 30 * 24 * 60 * 60 * 1000;
/** Its last use is written at most once a minute. */
const LAST_SEEN_EVERY_MS = 60 * 1000;

export function signedInDeviceOf(
  id: string,
  userId: string,
  tokenHash: string,
  { userAgent, addressKind }: SignInRequest,
  now: Date,
): SignedInDevice {
  return {
    id,
    userId,
    tokenHash,
    userAgent,
    addressKind,
    signedInAt: now,
    lastSeenAt: now,
    expiresAt: expiryAfter(now),
  };
}

export function isSignedIn(device: SignedInDevice, now: Date): boolean {
  return device.expiresAt > now;
}

/** The device as used at `now`, or undefined when its last use is recent enough to keep. */
export function seenAt(device: SignedInDevice, now: Date): SignedInDevice | undefined {
  if (now.getTime() - device.lastSeenAt.getTime() < LAST_SEEN_EVERY_MS) return undefined;
  return { ...device, lastSeenAt: now, expiresAt: expiryAfter(now) };
}

function expiryAfter(lastSeenAt: Date): Date {
  return new Date(lastSeenAt.getTime() + SIGNED_IN_FOR_MS);
}
