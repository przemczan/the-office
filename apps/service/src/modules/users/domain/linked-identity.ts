/**
 * The providers a user links an identity of (spec §2.10): GitHub now; Google joins with its Task,
 * here and in the contracts' `identityProviderSchema`.
 */
export type IdentityProviderId = "github";

const PROVIDER_NAMES: Readonly<Record<IdentityProviderId, string>> = { github: "GitHub" };

/** The provider as the pages name it. */
export function providerNameOf(provider: IdentityProviderId): string {
  return PROVIDER_NAMES[provider];
}

/**
 * Who a person is at a provider: the provider's own id for them, which never changes (GitHub's
 * numeric user id as text, Google's `sub`), and its name for them, such as a GitHub login, which
 * can change and is shown only.
 */
export interface ProviderIdentity {
  readonly provider: IdentityProviderId;
  readonly subject: string;
  readonly name: string;
}

/**
 * A user's identity at a provider, linked from their account. Continue with the provider signs in
 * only a linked identity, found by its provider and subject, never by an email or a name.
 */
export interface LinkedIdentity extends ProviderIdentity {
  readonly id: string;
  readonly userId: string;
  readonly linkedAt: Date;
  readonly lastSignedInAt: Date | undefined;
}

export function linkedIdentityOf(
  id: string,
  userId: string,
  identity: ProviderIdentity,
  linkedAt: Date,
): LinkedIdentity {
  return { ...identity, id, userId, linkedAt, lastSignedInAt: undefined };
}

/** Signed in with it now, under the name the provider gives today. */
export function signedInWith(linked: LinkedIdentity, name: string, at: Date): LinkedIdentity {
  return { ...linked, name, lastSignedInAt: at };
}
