import { Body, Controller, HttpCode, Post, Req, Res, UseFilters } from "@nestjs/common";
import {
  passkeyAuthenticationSchema,
  passkeyRequestOptionsSchema,
  type PasskeyAuthentication,
  type PasskeyRequestOptions,
  type SignInOutcome as SignInOutcomeMessage,
} from "@the-office/contracts";
import type { Request, Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { PasskeySignIn } from "../../application/passkey-sign-in.js";
import { SignInRefused } from "../../domain/sign-in-refused.js";
import {
  PASSKEY_CEREMONY_COOKIE,
  clearedPasskeyCeremonyCookie,
  passkeyCeremonyCookie,
} from "./passkey-ceremony-cookie.js";
import { ceremonyAnswerOf } from "./passkey-messages.js";
import { answerSignIn } from "./sign-in-answers.js";
import { cookieValueOf } from "./sign-in-cookie.js";
import { pageAddressOf, signInRequestOf } from "./sign-in-request.js";
import { SignInStarts } from "./sign-in-starts.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";
import { OpenWithoutSignIn } from "../../../../platform/http/sign-in-guard.js";

/**
 * Signing in with a passkey (spec §2.10), under `/sign-in`, which the guard leaves open: options
 * with a ceremony cookie, counted per address (`SignInStarts`), then the passkey's answer, which
 * the cookie ties to this browser.
 */
@Controller("sign-in/passkey")
@OpenWithoutSignIn()
@UseFilters(UserRefusalsFilter)
export class PasskeySignInController {
  constructor(
    private readonly passkeySignIn: PasskeySignIn,
    private readonly officeAddresses: OfficeAddresses,
    private readonly signInStarts: SignInStarts,
  ) {}

  @Post("options")
  @HttpCode(200)
  async options(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PasskeyRequestOptions> {
    this.signInStarts.take(request);
    const page = pageAddressOf(request, this.officeAddresses);
    const { ceremonyKey, options } = await this.passkeySignIn.start(page);
    response.setHeader("Set-Cookie", passkeyCeremonyCookie(ceremonyKey, page.secure));
    return passkeyRequestOptionsSchema.parse(options);
  }

  @Post()
  @HttpCode(200)
  async signIn(
    @Body(new ContractPipe(passkeyAuthenticationSchema)) authentication: PasskeyAuthentication,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInOutcomeMessage> {
    const page = pageAddressOf(request, this.officeAddresses);
    const forgotten = clearedPasskeyCeremonyCookie(page.secure);
    try {
      const outcome = await this.passkeySignIn.signIn(
        cookieValueOf(request.headers.cookie, PASSKEY_CEREMONY_COOKIE),
        ceremonyAnswerOf(authentication),
        page,
        signInRequestOf(request, this.officeAddresses.addressOf(request)),
      );
      return answerSignIn(outcome, page.secure, response, [forgotten]);
    } catch (error) {
      // The ceremony is taken whatever the outcome, so its cookie goes too.
      if (error instanceof SignInRefused) response.setHeader("Set-Cookie", forgotten);
      throw error;
    }
  }
}
