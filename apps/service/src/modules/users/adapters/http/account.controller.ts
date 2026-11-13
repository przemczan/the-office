import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import {
  authenticatorCodeSchema,
  codeAnswerSchema,
  type Account,
  type AuthenticatorCode,
  type AuthenticatorSetup,
  type CodeAnswer,
  type RecoveryCodes,
  type SignedInDevice as SignedInDeviceMessage,
} from "@the-office/contracts";
import type { Request, Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { Accounts } from "../../application/accounts.js";
import { Authenticators } from "../../application/authenticators.js";
import { SignedInDevices } from "../../application/signed-in-devices.js";
import type { SignedInDevice } from "../../domain/signed-in-device.js";
import { clearedSignInCookie } from "./sign-in-cookie.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/** Answers holding a secret or recovery codes are kept by no cache. */
const NO_STORE = "no-store";

/**
 * The signed-in user's account: their signed-in devices, Sign out, and their authenticator with its
 * recovery codes (spec §2.10).
 */
@Controller()
@UseFilters(UserRefusalsFilter)
export class AccountController {
  constructor(
    private readonly accounts: Accounts,
    private readonly signedInDevices: SignedInDevices,
    private readonly authenticators: Authenticators,
    private readonly officeAddresses: OfficeAddresses,
  ) {}

  /** Signs out this device and has the browser forget its cookie. */
  @Post("sign-out")
  @HttpCode(204)
  async signOut(
    @SignedIn() signedIn: SignedIn,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.signedInDevices.signOut(signedIn.userId, signedIn.signedInDeviceId);
    this.forgetCookie(request, response);
  }

  @Get("account")
  async account(@SignedIn() { userId }: SignedIn): Promise<Account> {
    const user = await this.accounts.of(userId);
    // Removing a user signs out their devices, so a signed-in device always has its user.
    if (user === undefined) throw new NotFoundException("No such user.");
    const authenticator = await this.authenticators.stateOf(user.id);
    return { id: user.id, name: user.name, email: user.email, authenticator };
  }

  /** Starts setting up the authenticator: its secret, sent this once. */
  @Post("account/authenticator")
  @Header("Cache-Control", NO_STORE)
  setUpAuthenticator(@SignedIn() { userId }: SignedIn): Promise<AuthenticatorSetup> {
    return this.authenticators.setUp(userId);
  }

  /** Turns the authenticator on with its first code; answers the recovery codes, this once. */
  @Post("account/authenticator/confirm")
  @HttpCode(200)
  @Header("Cache-Control", NO_STORE)
  async confirmAuthenticator(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(authenticatorCodeSchema)) { code }: AuthenticatorCode,
  ): Promise<RecoveryCodes> {
    return { recoveryCodes: [...(await this.authenticators.confirm(userId, code))] };
  }

  @Delete("account/authenticator")
  @HttpCode(204)
  async turnOffAuthenticator(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(codeAnswerSchema)) answer: CodeAnswer,
  ): Promise<void> {
    await this.authenticators.turnOff(userId, answer);
  }

  /** New recovery codes in place of all the old ones; answered this once. */
  @Post("account/recovery-codes")
  @HttpCode(200)
  @Header("Cache-Control", NO_STORE)
  async newRecoveryCodes(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(authenticatorCodeSchema)) { code }: AuthenticatorCode,
  ): Promise<RecoveryCodes> {
    return { recoveryCodes: [...(await this.authenticators.newRecoveryCodes(userId, code))] };
  }

  @Get("account/signed-in-devices")
  async signedInDeviceList(
    @SignedIn() { userId, signedInDeviceId }: SignedIn,
  ): Promise<SignedInDeviceMessage[]> {
    const devices = await this.signedInDevices.listOf(userId);
    return devices.map((device) => toMessage(device, signedInDeviceId));
  }

  /** Signs out one of the user's devices; this one's cookie is forgotten too. */
  @Delete("account/signed-in-devices/:id")
  @HttpCode(204)
  async signOutDevice(
    @SignedIn() signedIn: SignedIn,
    @Param("id") id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.signedInDevices.signOut(signedIn.userId, id);
    if (id === signedIn.signedInDeviceId) this.forgetCookie(request, response);
  }

  private forgetCookie(request: Request, response: Response): void {
    const { secure } = this.officeAddresses.addressOf(request);
    response.setHeader("Set-Cookie", clearedSignInCookie(secure));
  }
}

function toMessage(device: SignedInDevice, thisDeviceId: string): SignedInDeviceMessage {
  return {
    id: device.id,
    userAgent: device.userAgent ?? null,
    addressKind: device.addressKind,
    signedInAt: device.signedInAt.toISOString(),
    lastSeenAt: device.lastSeenAt.toISOString(),
    thisDevice: device.id === thisDeviceId,
  };
}
