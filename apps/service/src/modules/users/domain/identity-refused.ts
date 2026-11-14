import { providerNameOf, type IdentityProviderId } from "./linked-identity.js";
import type { WayUnavailable } from "./sign-in-way.js";

/**
 * Why Continue with a provider didn't sign in or link: the trip back wasn't one this browser
 * started, the identity isn't linked to a user, it is linked to another user, the user has
 * another identity there linked already, the provider isn't set up or doesn't work at the page's
 * address, or the provider refused.
 */
export type IdentityRefusal =
  | "trip"
  | "not-linked"
  | "linked-to-another"
  | "already-linked"
  | "unavailable"
  | "not-here"
  | "provider";

/** Continue with a provider refused, with why in the page's words. */
export class IdentityRefused extends Error {
  private constructor(
    readonly refusal: IdentityRefusal,
    message: string,
  ) {
    super(message);
    this.name = "IdentityRefused";
  }

  static trip(): IdentityRefused {
    return new IdentityRefused(
      "trip",
      "This wasn't started from this browser, or took longer than ten minutes. Try again.",
    );
  }

  static notLinked(provider: IdentityProviderId): IdentityRefused {
    const name = providerNameOf(provider);
    return new IdentityRefused(
      "not-linked",
      `This ${name} account isn't linked to a user of The Office. Sign in another way, then link it from your account.`,
    );
  }

  /** Never says which user, so it tells nothing of whose identity it is. */
  static linkedToAnother(provider: IdentityProviderId): IdentityRefused {
    return new IdentityRefused(
      "linked-to-another",
      `This ${providerNameOf(provider)} account is linked to another user of The Office.`,
    );
  }

  static alreadyLinked(provider: IdentityProviderId): IdentityRefused {
    const name = providerNameOf(provider);
    return new IdentityRefused(
      "already-linked",
      `Your account has another ${name} account linked: unlink it first.`,
    );
  }

  static unavailable(provider: IdentityProviderId): IdentityRefused {
    return new IdentityRefused(
      "unavailable",
      `Continue with ${providerNameOf(provider)} isn't set up in this Office.`,
    );
  }

  /** The provider doesn't work at the page's address, such as Google at an IP address. */
  static notHere(provider: IdentityProviderId, why: WayUnavailable): IdentityRefused {
    const at = why.elsewhere ?? "localhost or its public address";
    return new IdentityRefused(
      "not-here",
      `Continue with ${providerNameOf(provider)} doesn't work at this address: open The Office at ${at}.`,
    );
  }

  /** The provider's own reason, in the page's words. */
  static provider(reason: string): IdentityRefused {
    return new IdentityRefused("provider", reason);
  }
}
