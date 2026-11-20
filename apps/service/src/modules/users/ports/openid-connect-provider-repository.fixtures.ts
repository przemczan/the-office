import type { OpenIdConnectProvider } from "../domain/openid-connect-provider.js";
import { OpenIdConnectProviderRepository } from "./openid-connect-provider-repository.js";

/**
 * The OpenID Connect provider kept in memory: `openid_connect_provider` is one row of the database
 * every test file shares, so only `postgres-openid-connect-provider-repository.test.ts` writes it.
 */
export class InMemoryOpenIdConnectProviderRepository extends OpenIdConnectProviderRepository {
  /** The issuer of the provider saved last, kept through its removal. */
  private savedIssuer: string | undefined;

  constructor(public provider: OpenIdConnectProvider | undefined = undefined) {
    super();
    this.savedIssuer = provider?.issuer;
  }

  find(): Promise<OpenIdConnectProvider | undefined> {
    return Promise.resolve(this.provider);
  }

  lastIssuer(): Promise<string | undefined> {
    return Promise.resolve(this.savedIssuer);
  }

  save(provider: OpenIdConnectProvider): Promise<void> {
    this.provider = provider;
    this.savedIssuer = provider.issuer;
    return Promise.resolve();
  }

  remove(_at: Date): Promise<boolean> {
    const had = this.provider !== undefined;
    this.provider = undefined;
    return Promise.resolve(had);
  }
}

/** Binds the OpenID Connect provider to one in memory, saved as given or not yet. */
export function openIdConnectProviderForTests(provider?: OpenIdConnectProvider): {
  provide: typeof OpenIdConnectProviderRepository;
  useValue: InMemoryOpenIdConnectProviderRepository;
} {
  return {
    provide: OpenIdConnectProviderRepository,
    useValue: new InMemoryOpenIdConnectProviderRepository(provider),
  };
}
