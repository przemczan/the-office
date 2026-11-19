import type { IdentityProviderId } from "./linked-identity.js";
import type { PageAddress } from "./page-address.js";
import { relyingPartyAt } from "./relying-party.js";

/**
 * The ways to sign in (spec §2.10): a password, a passkey, and Continue with each identity
 * provider, each with the addresses it works at.
 */
export type SignInWayKind = "password" | "passkey" | IdentityProviderId;

/**
 * Why a way doesn't work on the page's address: it is an IP address, which a passkey can't be
 * kept for, or it isn't a domain name over HTTPS.
 */
export type WayUnavailableReason = "ip-address" | "needs-https-domain";

/** A way that doesn't work here, and the address it works at instead, when there is one. */
export interface WayUnavailable {
  readonly reason: WayUnavailableReason;
  readonly elsewhere?: string;
}

export interface SignInWay {
  readonly kind: SignInWayKind;
  /**
   * Whether it signs the user in alone, with no second step such as an authenticator code: only a
   * passkey, which is something the user has and is verified on their device.
   */
  readonly enoughAlone: boolean;
  /** Why it doesn't work on a page opened at this address, or undefined when it does. */
  unavailableAt(page: PageAddress): WayUnavailable | undefined;
  /** Whether it is set up, such as an OAuth client entered; a password always is. */
  isAvailable(): Promise<boolean>;
  /** A provider's name as its button shows it, "Continue with <name>"; none for a password or passkey. */
  name?(): Promise<string>;
}

/** A password works at every address, and asks for the authenticator code after it. */
export const PASSWORD_WAY: SignInWay = {
  kind: "password",
  enoughAlone: false,
  unavailableAt: () => undefined,
  isAvailable: () => Promise.resolve(true),
};

/**
 * Why a page at this address isn't a name the browser treats as secure, `localhost` or the public
 * address's domain over HTTPS, which a passkey's relying party and Google's redirect URIs need.
 */
export function secureNameMissingAt(page: PageAddress): WayUnavailable | undefined {
  const relyingParty = relyingPartyAt(page);
  return "unavailable" in relyingParty ? relyingParty.unavailable : undefined;
}

/** A passkey works where the page's address can be its relying party. */
export const PASSKEY_WAY: SignInWay = {
  kind: "passkey",
  enoughAlone: true,
  unavailableAt: secureNameMissingAt,
  isAvailable: () => Promise.resolve(true),
};
