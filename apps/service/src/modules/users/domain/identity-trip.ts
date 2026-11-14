import type { IdentityProviderId } from "./linked-identity.js";

/** A provider's codes last ten minutes, so a trip that takes longer can't finish anyway. */
export const IDENTITY_TRIP_MS = 10 * 60 * 1000;

/**
 * Why the browser went to the provider: to sign in, tied to the browser by the SHA-256 of a nonce
 * its trip cookie carries, so nobody can send someone else's browser back signed in as them; or to
 * link an identity to a user, tied to the signed-in device that started it, so nobody can link
 * their identity to someone else's account.
 */
export type TripPurpose =
  | { readonly kind: "sign-in"; readonly nonceHash: string }
  | { readonly kind: "link"; readonly userId: string; readonly signedInDeviceId: string };

/** A trip to a provider's authorize page, kept until the provider sends the browser back. */
export interface IdentityTrip {
  readonly provider: IdentityProviderId;
  readonly purpose: TripPurpose;
  /** PKCE's secret. */
  readonly codeVerifier: string;
  /** The callback URL the provider was asked to send the browser back to. */
  readonly redirectUri: string;
  /** A path of The Office's own to go to once back. */
  readonly returnTo: string;
  readonly startedAt: Date;
}

export function isUnderway(trip: IdentityTrip, now: Date): boolean {
  return now.getTime() - trip.startedAt.getTime() < IDENTITY_TRIP_MS;
}

/**
 * `returnTo` when it is a path on The Office's own origin, so a link can't send the browser to
 * another site; otherwise `fallback`.
 */
export function ownPathOr(returnTo: string | undefined, fallback: string): string {
  if (returnTo === undefined || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return fallback;
  }
  const base = "http://office.invalid";
  try {
    const url = new URL(returnTo, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
