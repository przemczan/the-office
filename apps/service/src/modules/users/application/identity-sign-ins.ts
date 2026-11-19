import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { IdentityRefused } from "../domain/identity-refused.js";
import type { IdentityTrip, TripPurpose } from "../domain/identity-trip.js";
import { signedInWith, type IdentityProviderId } from "../domain/linked-identity.js";
import type { PageAddress } from "../domain/page-address.js";
import type { SignInWay } from "../domain/sign-in-way.js";
import type { SignInRequest } from "../domain/signed-in-device.js";
import type { IdentityProvider } from "../ports/identity-provider.js";
import { LinkedIdentityRepository } from "../ports/linked-identity-repository.js";
import type { SecondStep } from "../ports/second-steps.js";
import { UserRepository } from "../ports/user-repository.js";
import { IdentityProviders } from "./identity-providers.js";
import { IdentityTrips } from "./identity-trips.js";
import { LinkedIdentities, refused } from "./linked-identities.js";
import { SignInWays } from "./sign-in-ways.js";
import { SignIns, type SignedInOutcome } from "./sign-ins.js";

/** A sign-in's trip to the provider: its authorize page, and the nonce the browser's trip cookie carries. */
export interface IdentitySignInStart {
  readonly authorizeUrl: string;
  readonly nonce: string;
}

/** What the provider sent the browser back to the callback with. */
export interface ProviderReturn {
  readonly state: string | undefined;
  readonly code: string | undefined;
  readonly error: string | undefined;
}

/** What the browser coming back carries: its trip cookie's nonce, and its signed-in device, if any. */
export interface ReturningBrowser {
  readonly nonce: string | undefined;
  readonly signedIn: { readonly userId: string; readonly signedInDeviceId: string } | undefined;
}

/**
 * How the trip back ended: signed in by `SignIns.finish`, linked, or refused with why, the trip's
 * purpose told when it was found.
 */
export type IdentityReturnOutcome =
  | {
      readonly kind: "signed-in";
      readonly outcome: SignedInOutcome | SecondStep;
      readonly returnTo: string;
    }
  | { readonly kind: "linked"; readonly returnTo: string }
  | {
      readonly kind: "refused";
      readonly purpose: TripPurpose["kind"] | undefined;
      readonly reason: string;
    };

/**
 * Continue with a provider (spec §2.10): the sign-in's trip to the provider, and the one callback
 * the provider sends the browser back to, for signing in and for linking alike. It signs in only an
 * identity linked to a user, found by the provider's id for it, never by an email or a name, and
 * ends in `SignIns.finish`, so a second step applies. Each provider is a way on the sign-in page
 * once it is set up.
 */
@Injectable()
export class IdentitySignIns implements OnModuleInit {
  constructor(
    private readonly providers: IdentityProviders,
    private readonly trips: IdentityTrips,
    private readonly linkedIdentities: LinkedIdentityRepository,
    private readonly linking: LinkedIdentities,
    private readonly users: UserRepository,
    private readonly signIns: SignIns,
    private readonly signInWays: SignInWays,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    for (const bound of this.providers.all) this.signInWays.add(wayOf(bound));
  }

  /**
   * The provider's authorize page for signing in, the provider sending the browser back to
   * `redirectUri`, and the nonce the browser keeps in its trip cookie, without which the trip back
   * signs nothing in. Throws `IdentityRefused` when the provider isn't set up or doesn't work at
   * the page's address.
   */
  async start(
    provider: IdentityProviderId,
    page: PageAddress,
    redirectUri: string,
    returnTo: string,
  ): Promise<IdentitySignInStart> {
    const bound = await this.providers.startingAt(provider, page);
    const nonce = randomBytes(32).toString("base64url");
    const { state, codeVerifier } = this.trips.start({
      provider,
      purpose: { kind: "sign-in", nonceHash: hashOf(nonce) },
      redirectUri,
      returnTo,
    });
    const authorizeUrl = await bound
      .authorizeUrl({ state, codeVerifier, redirectUri })
      .catch(refused);
    return { authorizeUrl, nonce };
  }

  /** The trip back from the provider, for a sign-in or a link, its trip taken whatever comes of it. */
  async returned(
    provider: IdentityProviderId,
    { state, code, error }: ProviderReturn,
    browser: ReturningBrowser,
    request: SignInRequest,
  ): Promise<IdentityReturnOutcome> {
    const trip = this.trips.take(state);
    if (trip === undefined || trip.provider !== provider || !isThisBrowsers(trip, browser)) {
      return refusal(trip?.purpose.kind, IdentityRefused.trip());
    }
    try {
      const identity = await this.providers
        .of(provider)
        .identityOf({ code, error, codeVerifier: trip.codeVerifier, redirectUri: trip.redirectUri })
        .catch(refused);
      if (trip.purpose.kind === "link") {
        await this.linking.link(trip.purpose.userId, { provider, ...identity });
        return { kind: "linked", returnTo: trip.returnTo };
      }
      const outcome = await this.signIn(provider, identity, request);
      return { kind: "signed-in", outcome, returnTo: trip.returnTo };
    } catch (failure) {
      if (failure instanceof IdentityRefused) return refusal(trip.purpose.kind, failure);
      throw failure;
    }
  }

  private async signIn(
    provider: IdentityProviderId,
    { subject, name }: { readonly subject: string; readonly name: string },
    request: SignInRequest,
  ): Promise<SignedInOutcome | SecondStep> {
    const linked = await this.linkedIdentities.findBySubject(provider, subject);
    const user = linked && (await this.users.find(linked.userId));
    if (linked === undefined || user === undefined || user.removedAt !== undefined) {
      throw IdentityRefused.notLinked(await this.providers.nameOf(provider));
    }
    await this.linkedIdentities.save(signedInWith(linked, name, this.schedule.now()));
    return this.signIns.finish(user, wayOf(this.providers.of(provider)), request);
  }
}

/** Continue with a provider, a way that asks for the authenticator code after it, as a password does. */
function wayOf(bound: IdentityProvider): SignInWay {
  return {
    kind: bound.provider,
    enoughAlone: false,
    unavailableAt: (page) => bound.unavailableAt(page),
    isAvailable: () => bound.isAvailable(),
    name: () => bound.displayName(),
  };
}

/** A sign-in's trip back needs the nonce of its cookie; a link's, the signed-in device that started it. */
function isThisBrowsers(trip: IdentityTrip, browser: ReturningBrowser): boolean {
  const { purpose } = trip;
  if (purpose.kind === "link") {
    return (
      browser.signedIn?.signedInDeviceId === purpose.signedInDeviceId &&
      browser.signedIn.userId === purpose.userId
    );
  }
  if (browser.nonce === undefined) return false;
  const expected = Buffer.from(purpose.nonceHash, "hex");
  const given = Buffer.from(hashOf(browser.nonce), "hex");
  return timingSafeEqual(expected, given);
}

function hashOf(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function refusal(
  purpose: TripPurpose["kind"] | undefined,
  why: IdentityRefused,
): IdentityReturnOutcome {
  return { kind: "refused", purpose, reason: why.message };
}
