import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  isAnotherIssuer,
  openIdConnectEntryOf,
  openIdConnectProviderOf,
  type DiscoveredProvider,
  type OpenIdConnectProviderEntry,
} from "../domain/openid-connect-provider.js";
import { OpenIdConnectProviderRemoved, OpenIdConnectProviderSaved } from "../domain/user-events.js";
import { UserRefused } from "../domain/user-refused.js";
import { LinkedIdentityRepository } from "../ports/linked-identity-repository.js";
import {
  OpenIdConnectDiscovery,
  OpenIdConnectDiscoveryFailed,
} from "../ports/openid-connect-discovery.js";
import { OpenIdConnectProviderRepository } from "../ports/openid-connect-provider-repository.js";

/** The saved provider as the web sees it, and whether a secret is kept, never the secret. */
export interface OpenIdConnectProviderShown {
  readonly name: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly secretSet: boolean;
}

/**
 * The OpenID Connect provider, from Settings › Signing in (spec §2.10): one per Office, which any
 * user saves, changes or removes. Saving reads the issuer's discovery document anew. Removing it
 * keeps the linked identities, which sign in again once it is saved; saving one at another issuer
 * unlinks them, as a `sub` means something only at its own issuer.
 */
@Injectable()
export class OpenIdConnectProviders {
  constructor(
    private readonly providers: OpenIdConnectProviderRepository,
    private readonly discovery: OpenIdConnectDiscovery,
    private readonly linkedIdentities: LinkedIdentityRepository,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  async shown(): Promise<OpenIdConnectProviderShown | undefined> {
    const provider = await this.providers.find();
    return provider && shownOf(provider.name, provider.issuer, provider.clientId);
  }

  /**
   * Saves it, with the endpoints its discovery document names; an empty secret keeps the one
   * saved. Throws `UserRefused` with every problem of the entry, or why discovery failed.
   */
  async save(
    userId: string,
    entry: OpenIdConnectProviderEntry,
  ): Promise<OpenIdConnectProviderShown> {
    const saved = await this.providers.find();
    const checked = openIdConnectEntryOf(entry, saved);
    if ("problems" in checked) throw new UserRefused(checked.problems);
    const discovered = await this.discovered(checked.checked.issuer);
    const made = openIdConnectProviderOf(checked.checked, discovered, this.schedule.now());
    if ("problems" in made) throw new UserRefused(made.problems);
    const provider = made.checked;
    // Unlinked before the new issuer is saved, so a failure in between never leaves the old
    // issuer's `sub`s able to sign in at the new one.
    const identitiesUnlinked = isAnotherIssuer(await this.providers.lastIssuer(), provider)
      ? await this.linkedIdentities.removeAllAt("openid-connect")
      : 0;
    await this.providers.save(provider);
    await this.eventBus.publish(
      new OpenIdConnectProviderSaved(
        userId,
        provider.name,
        provider.issuer,
        provider.clientId,
        identitiesUnlinked,
        provider.savedAt,
      ),
    );
    return shownOf(provider.name, provider.issuer, provider.clientId);
  }

  async remove(userId: string): Promise<void> {
    if (await this.providers.remove(this.schedule.now())) {
      await this.eventBus.publish(new OpenIdConnectProviderRemoved(userId));
    }
  }

  private async discovered(issuer: string): Promise<DiscoveredProvider> {
    try {
      return await this.discovery.discover(issuer);
    } catch (failure) {
      if (failure instanceof OpenIdConnectDiscoveryFailed) throw new UserRefused([failure.reason]);
      throw failure;
    }
  }
}

/** A saved provider always has a secret: saving refuses one without. */
function shownOf(name: string, issuer: string, clientId: string): OpenIdConnectProviderShown {
  return { name, issuer, clientId, secretSet: true };
}
