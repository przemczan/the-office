import { randomUUID } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { IdentityRefused } from "../domain/identity-refused.js";
import {
  linkedIdentityOf,
  type IdentityProviderId,
  type LinkedIdentity,
  type ProviderIdentity,
} from "../domain/linked-identity.js";
import type { PageAddress } from "../domain/page-address.js";
import type { WayUnavailable } from "../domain/sign-in-way.js";
import { IdentityLinked, IdentityUnlinked, UserRemoved } from "../domain/user-events.js";
import { LinkedIdentityNotFound } from "../domain/user-refused.js";
import { IdentityProviderFailed } from "../ports/identity-provider.js";
import { LinkedIdentityRepository } from "../ports/linked-identity-repository.js";
import { IdentityProviders } from "./identity-providers.js";
import { IdentityTrips } from "./identity-trips.js";

/**
 * Each provider bound, whether it is set up, why it doesn't work at the page's address, and the
 * user's identity there when linked.
 */
export interface ProviderLink {
  readonly provider: IdentityProviderId;
  readonly available: boolean;
  readonly unavailableHere: WayUnavailable | undefined;
  readonly linked: LinkedIdentity | undefined;
}

/**
 * A user's linked identities (spec §2.10), from their account: listed, linked through a trip to
 * the provider tied to the signed-in device that started it, and unlinked. An identity is linked
 * to one user only; a removed user's go with them.
 */
@Injectable()
export class LinkedIdentities implements OnModuleInit {
  constructor(
    private readonly linkedIdentities: LinkedIdentityRepository,
    private readonly providers: IdentityProviders,
    private readonly trips: IdentityTrips,
    private readonly schedule: Schedule,
    private readonly eventBus: EventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(UserRemoved, ({ userId }) => this.linkedIdentities.removeAllOf(userId));
  }

  async listOf(userId: string, page: PageAddress): Promise<readonly ProviderLink[]> {
    const linked = await this.linkedIdentities.listOf(userId);
    return Promise.all(
      this.providers.all.map(async (bound) => ({
        provider: bound.provider,
        available: await bound.isAvailable(),
        unavailableHere: bound.unavailableAt(page),
        linked: linked.find((identity) => identity.provider === bound.provider),
      })),
    );
  }

  /** Why the provider doesn't work at the page's address, or undefined when it does. */
  unavailableAt(provider: IdentityProviderId, page: PageAddress): WayUnavailable | undefined {
    return this.providers.of(provider).unavailableAt(page);
  }

  /**
   * The provider's authorize page, for linking the identity the person signs in to there; the
   * provider sends the browser back to `redirectUri`, The Office's callback, which links it only
   * for this signed-in device. Throws `IdentityRefused` when the provider isn't set up or doesn't
   * work at the page's address.
   */
  async startLinking(
    userId: string,
    signedInDeviceId: string,
    provider: IdentityProviderId,
    page: PageAddress,
    redirectUri: string,
    returnTo: string,
  ): Promise<string> {
    const bound = await this.providers.startingAt(provider, page);
    const { state, codeVerifier } = this.trips.start({
      provider,
      purpose: { kind: "link", userId, signedInDeviceId },
      redirectUri,
      returnTo,
    });
    return bound.authorizeUrl({ state, codeVerifier, redirectUri }).catch(refused);
  }

  /**
   * Links the identity to the user. Linking it again as the same user only takes its new name;
   * one linked to another user, or a second of the same provider, is refused with `IdentityRefused`.
   */
  async link(userId: string, identity: ProviderIdentity): Promise<void> {
    const existing = await this.linkedIdentities.findBySubject(identity.provider, identity.subject);
    if (existing !== undefined) {
      if (existing.userId !== userId) throw IdentityRefused.linkedToAnother(identity.provider);
      await this.linkedIdentities.save({ ...existing, name: identity.name });
      return;
    }
    const now = this.schedule.now();
    const added = await this.linkedIdentities.add(
      linkedIdentityOf(randomUUID(), userId, identity, now),
    );
    if (!added) {
      // Taken meanwhile, or the user has another identity of this provider.
      const taken = await this.linkedIdentities.findBySubject(identity.provider, identity.subject);
      if (taken !== undefined && taken.userId !== userId) {
        throw IdentityRefused.linkedToAnother(identity.provider);
      }
      if (taken === undefined) throw IdentityRefused.alreadyLinked(identity.provider);
      return;
    }
    await this.eventBus.publish(new IdentityLinked(userId, identity.provider, now));
  }

  /** Unlinks the user's own identity of the provider: it signs nobody in any more. */
  async unlink(userId: string, provider: IdentityProviderId): Promise<void> {
    if (!(await this.linkedIdentities.remove(userId, provider))) throw new LinkedIdentityNotFound();
    await this.eventBus.publish(new IdentityUnlinked(userId, provider));
  }
}

/** The provider's failure, in the page's words. */
export function refused(error: unknown): never {
  if (error instanceof IdentityProviderFailed) throw IdentityRefused.provider(error.reason);
  throw error;
}
