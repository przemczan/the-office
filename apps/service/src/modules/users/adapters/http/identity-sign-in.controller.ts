import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseFilters } from "@nestjs/common";
import {
  identitySignInSchema,
  LINK_FAILED_PARAMETER,
  LINKED_IDENTITIES_PATH,
  SIGN_IN_FAILED_PARAMETER,
  type IdentityAuthorization,
  type IdentitySignIn,
} from "@the-office/contracts";
import type { Request, Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import {
  IdentitySignIns,
  type IdentityReturnOutcome,
} from "../../application/identity-sign-ins.js";
import { ownPathOr } from "../../domain/identity-trip.js";
import type { IdentityProviderId } from "../../domain/linked-identity.js";
import { CookieSignedInRequests } from "./cookie-signed-in-requests.js";
import { identityCallbackUrlOf } from "./identity-callback-urls.js";
import {
  clearedIdentityTripCookie,
  IDENTITY_TRIP_COOKIE,
  identityTripCookie,
} from "./identity-trip-cookie.js";
import { redirectSignIn } from "./sign-in-answers.js";
import { cookieValueOf } from "./sign-in-cookie.js";
import { pageAddressOf, signInRequestOf } from "./sign-in-request.js";
import { textOrUndefined } from "../../../../platform/http/query-text.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/** The sign-in page, outside the shell. */
const SIGN_IN_PATH = "/sign-in";

/**
 * Continue with GitHub and Continue with Google (spec §2.10), under `/sign-in`, which the guard
 * leaves open: each sign-in's start, with a trip cookie, and the one callback each provider sends
 * the browser back to, for signing in and for linking alike, which redirects on every outcome.
 * Each provider has its own explicit routes, so none shadows `/sign-in/password`.
 */
@Controller("sign-in")
@UseFilters(UserRefusalsFilter)
export class IdentitySignInController {
  constructor(
    private readonly identitySignIns: IdentitySignIns,
    private readonly signedInRequests: CookieSignedInRequests,
    private readonly officeAddresses: OfficeAddresses,
  ) {}

  @Post("github")
  @HttpCode(200)
  startGitHub(
    @Body(new ContractPipe(identitySignInSchema)) { returnTo }: IdentitySignIn,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<IdentityAuthorization> {
    return this.start("github", returnTo, request, response);
  }

  @Get("github/callback")
  gitHubReturned(
    @Query("code") code: unknown,
    @Query("state") state: unknown,
    @Query("error") error: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.returned("github", { code, state, error }, request, response);
  }

  @Post("google")
  @HttpCode(200)
  startGoogle(
    @Body(new ContractPipe(identitySignInSchema)) { returnTo }: IdentitySignIn,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<IdentityAuthorization> {
    return this.start("google", returnTo, request, response);
  }

  @Get("google/callback")
  googleReturned(
    @Query("code") code: unknown,
    @Query("state") state: unknown,
    @Query("error") error: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.returned("google", { code, state, error }, request, response);
  }

  private async start(
    provider: IdentityProviderId,
    returnTo: string | undefined,
    request: Request,
    response: Response,
  ): Promise<IdentityAuthorization> {
    const page = pageAddressOf(request, this.officeAddresses);
    const { authorizeUrl, nonce } = await this.identitySignIns.start(
      provider,
      page,
      identityCallbackUrlOf(page, request, provider),
      ownPathOr(returnTo, "/"),
    );
    response.setHeader("Set-Cookie", identityTripCookie(nonce, page.secure));
    return { authorizeUrl };
  }

  /**
   * A page the browser navigates to, so every outcome redirects: signed in, to where the sign-in
   * page was to return, or first to the code page when the authenticator code is needed; linked,
   * to the account; refused, to the sign-in page or the account with why. A link needs the signed-in device that started it, checked here as the guard skips this.
   */
  private async returned(
    provider: IdentityProviderId,
    query: { readonly code: unknown; readonly state: unknown; readonly error: unknown },
    request: Request,
    response: Response,
  ): Promise<void> {
    const address = this.officeAddresses.addressOf(request);
    const signedIn = await this.signedInRequests.signedInOf(request);
    const outcome = await this.identitySignIns.returned(
      provider,
      {
        code: textOrUndefined(query.code),
        state: textOrUndefined(query.state),
        error: textOrUndefined(query.error),
      },
      { nonce: cookieValueOf(request.headers.cookie, IDENTITY_TRIP_COOKIE), signedIn },
      signInRequestOf(request, address),
    );
    const tripCleared = clearedIdentityTripCookie(address.secure);
    switch (outcome.kind) {
      case "signed-in":
        redirectSignIn(outcome.outcome, address.secure, outcome.returnTo, response, [tripCleared]);
        return;
      case "linked":
        response.setHeader("Set-Cookie", tripCleared);
        response.redirect(303, outcome.returnTo);
        return;
      case "refused":
        response.setHeader("Set-Cookie", tripCleared);
        response.redirect(303, refusedLocationOf(outcome, signedIn !== undefined));
        return;
      default: {
        const unknown: never = outcome;
        throw new Error(`Continue with a provider ended as nothing known: ${String(unknown)}.`);
      }
    }
  }
}

/** Back where the trip started, with why: the sign-in page, or the account's linked identities. */
function refusedLocationOf(
  outcome: Extract<IdentityReturnOutcome, { readonly kind: "refused" }>,
  browserSignedIn: boolean,
): string {
  // A trip not found tells no purpose: a signed-in browser was most likely linking.
  const linking = (outcome.purpose ?? (browserSignedIn ? "link" : "sign-in")) === "link";
  const [path, parameter] = linking
    ? [LINKED_IDENTITIES_PATH, LINK_FAILED_PARAMETER]
    : [SIGN_IN_PATH, SIGN_IN_FAILED_PARAMETER];
  return `${path}?${new URLSearchParams({ [parameter]: outcome.reason })}`;
}
