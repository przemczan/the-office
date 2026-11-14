import type { RelyingParty } from "./relying-party.js";

/** A ceremony works for 5 minutes after it starts. */
const PENDING_FOR_MS = 5 * 60 * 1000;

/**
 * A passkey being added or used, between the options the browser was given and its answer: the
 * challenge and the relying party stay here, never trusted back from the browser.
 */
export type PendingCeremony =
  | (PendingCeremonyBase & {
      readonly kind: "adding";
      /** Adding is the signed-in user's own, tied to the device that started it. */
      readonly userId: string;
      readonly signedInDeviceId: string;
    })
  | (PendingCeremonyBase & { readonly kind: "signing-in" });

interface PendingCeremonyBase {
  readonly challenge: string;
  readonly relyingParty: RelyingParty;
  readonly expiresAt: Date;
}

export function addingCeremonyOf(
  challenge: string,
  relyingParty: RelyingParty,
  userId: string,
  signedInDeviceId: string,
  now: Date,
): PendingCeremony {
  return {
    kind: "adding",
    challenge,
    relyingParty,
    userId,
    signedInDeviceId,
    expiresAt: expiryAfter(now),
  };
}

export function signingInCeremonyOf(
  challenge: string,
  relyingParty: RelyingParty,
  now: Date,
): PendingCeremony {
  return { kind: "signing-in", challenge, relyingParty, expiresAt: expiryAfter(now) };
}

export function isPending(ceremony: PendingCeremony, now: Date): boolean {
  return ceremony.expiresAt > now;
}

export function sameRelyingParty(one: RelyingParty, other: RelyingParty): boolean {
  return one.rpId === other.rpId && one.origin === other.origin;
}

function expiryAfter(now: Date): Date {
  return new Date(now.getTime() + PENDING_FOR_MS);
}
