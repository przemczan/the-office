import type { OpenIdConnectProvider } from "../domain/openid-connect-provider.js";

/** Where the one OpenID Connect provider is kept, its secret as entered, as it is sent to the provider. */
export abstract class OpenIdConnectProviderRepository {
  /** The provider saved, unless it was removed since. */
  abstract find(): Promise<OpenIdConnectProvider | undefined>;

  /**
   * The issuer of the provider saved last, removed since or not, which the identities linked
   * through Continue with <name> belong to.
   */
  abstract lastIssuer(): Promise<string | undefined>;

  /** Keeps it in place of the one saved. */
  abstract save(provider: OpenIdConnectProvider): Promise<void>;

  /** Forgets it and its secret, keeping its issuer; says whether there was one. */
  abstract remove(at: Date): Promise<boolean>;
}
