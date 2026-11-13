import { Body, Controller, Get, HttpCode, Post, Req, Res, UseFilters } from "@nestjs/common";
import {
  firstUserSchema,
  passwordSignInSchema,
  type FirstUser as FirstUserMessage,
  type PasswordSignIn as PasswordSignInMessage,
  type SignInOutcome as SignInOutcomeMessage,
  type SignInPage,
} from "@the-office/contracts";
import type { Request, Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { FirstUser } from "../../application/first-user.js";
import { PasswordSignIn } from "../../application/password-sign-in.js";
import { SignInWays } from "../../application/sign-in-ways.js";
import type { SignInOutcome } from "../../application/sign-ins.js";
import { signInCookie } from "./sign-in-cookie.js";
import { addressKindOf, signInRequestOf } from "./sign-in-request.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/**
 * The sign-in pages (spec §2.10), open to anyone that passed the Host and Origin checks: every way
 * to sign in, and later its callback, lives under `/sign-in`, which the guard leaves open.
 */
@Controller("sign-in")
@UseFilters(UserRefusalsFilter)
export class SignInController {
  constructor(
    private readonly firstUser: FirstUser,
    private readonly passwordSignIn: PasswordSignIn,
    private readonly signInWays: SignInWays,
    private readonly officeAddresses: OfficeAddresses,
  ) {}

  @Get()
  async page(@Req() request: Request): Promise<SignInPage> {
    const addressKind = addressKindOf(this.officeAddresses.addressOf(request));
    const ways = await this.signInWays.at(addressKind);
    return { firstRun: await this.firstUser.isAwaited(), ways: ways.map((kind) => ({ kind })) };
  }

  @Post("first-user")
  async createFirstUser(
    @Body(new ContractPipe(firstUserSchema)) firstUser: FirstUserMessage,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInOutcomeMessage> {
    const address = this.officeAddresses.addressOf(request);
    const outcome = await this.firstUser.create(firstUser, signInRequestOf(request, address));
    return answered(outcome, address.secure, response);
  }

  @Post("password")
  @HttpCode(200)
  async withPassword(
    @Body(new ContractPipe(passwordSignInSchema)) { email, password }: PasswordSignInMessage,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInOutcomeMessage> {
    const address = this.officeAddresses.addressOf(request);
    const outcome = await this.passwordSignIn.signIn(
      email,
      password,
      signInRequestOf(request, address),
    );
    return answered(outcome, address.secure, response);
  }
}

/** The outcome as the web reads it; signed in, the cookie carries the token, never the body. */
function answered(
  outcome: SignInOutcome,
  secure: boolean,
  response: Response,
): SignInOutcomeMessage {
  response.setHeader("Set-Cookie", signInCookie(outcome.token, secure));
  return { outcome: outcome.outcome };
}
