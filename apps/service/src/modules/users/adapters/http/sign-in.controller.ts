import { Body, Controller, Get, HttpCode, Post, Req, Res, UseFilters } from "@nestjs/common";
import {
  codeAnswerSchema,
  firstPasswordSchema,
  firstUserSchema,
  passwordSignInSchema,
  type CodeAnswer,
  type FirstPassword as FirstPasswordMessage,
  type FirstUser as FirstUserMessage,
  type PasswordSignIn as PasswordSignInMessage,
  type SignInOutcome as SignInOutcomeMessage,
  type SignInPage,
} from "@the-office/contracts";
import type { Request, Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { CodeSignIn } from "../../application/code-sign-in.js";
import { FirstPassword } from "../../application/first-password.js";
import { FirstUser } from "../../application/first-user.js";
import { PasswordSignIn } from "../../application/password-sign-in.js";
import { SignInWays } from "../../application/sign-in-ways.js";
import { answerSignIn } from "./sign-in-answers.js";
import { pendingSignInTokenOf } from "./sign-in-cookie.js";
import { pageAddressOf, signInRequestOf } from "./sign-in-request.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/**
 * The sign-in pages (spec §2.10), open to anyone that passed the Host and Origin checks: every way
 * to sign in, its callback and the authenticator code live under `/sign-in`, which the guard leaves
 * open.
 */
@Controller("sign-in")
@UseFilters(UserRefusalsFilter)
export class SignInController {
  constructor(
    private readonly firstUser: FirstUser,
    private readonly passwordSignIn: PasswordSignIn,
    private readonly codeSignIn: CodeSignIn,
    private readonly firstPassword: FirstPassword,
    private readonly signInWays: SignInWays,
    private readonly officeAddresses: OfficeAddresses,
  ) {}

  @Get()
  async page(@Req() request: Request): Promise<SignInPage> {
    const { ways, unavailable } = await this.signInWays.at(
      pageAddressOf(request, this.officeAddresses),
    );
    return {
      firstRun: await this.firstUser.isAwaited(),
      ways: ways.map((kind) => ({ kind })),
      unavailable: [...unavailable],
    };
  }

  @Post("first-user")
  async createFirstUser(
    @Body(new ContractPipe(firstUserSchema)) { setupToken, ...newUser }: FirstUserMessage,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInOutcomeMessage> {
    const address = this.officeAddresses.addressOf(request);
    const outcome = await this.firstUser.create(
      newUser,
      setupToken,
      signInRequestOf(request, address),
    );
    return answerSignIn(outcome, address.secure, response);
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
    return answerSignIn(outcome, address.secure, response);
  }

  /** The authenticator code, or a recovery code, for the pending sign-in its cookie names. */
  @Post("code")
  @HttpCode(200)
  async withCode(
    @Body(new ContractPipe(codeAnswerSchema)) answer: CodeAnswer,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInOutcomeMessage> {
    const address = this.officeAddresses.addressOf(request);
    const outcome = await this.codeSignIn.signIn(
      pendingSignInTokenOf(request.headers.cookie),
      answer,
      signInRequestOf(request, address),
    );
    return answerSignIn(outcome, address.secure, response);
  }

  /** A user added by another sets their own password, with their one-time password, and is signed in. */
  @Post("set-password")
  @HttpCode(200)
  async setPassword(
    @Body(new ContractPipe(firstPasswordSchema)) firstPassword: FirstPasswordMessage,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInOutcomeMessage> {
    const address = this.officeAddresses.addressOf(request);
    const outcome = await this.firstPassword.set(firstPassword, signInRequestOf(request, address));
    return answerSignIn(outcome, address.secure, response);
  }
}
