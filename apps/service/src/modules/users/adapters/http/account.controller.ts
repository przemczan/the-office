import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { Account, SignedInDevice as SignedInDeviceMessage } from "@the-office/contracts";
import type { Request, Response } from "express";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { Accounts } from "../../application/accounts.js";
import { SignedInDevices } from "../../application/signed-in-devices.js";
import type { SignedInDevice } from "../../domain/signed-in-device.js";
import { clearedSignInCookie } from "./sign-in-cookie.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/** The signed-in user's account and signed-in devices, and Sign out (spec §2.10). */
@Controller()
@UseFilters(UserRefusalsFilter)
export class AccountController {
  constructor(
    private readonly accounts: Accounts,
    private readonly signedInDevices: SignedInDevices,
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
    return { id: user.id, name: user.name, email: user.email };
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
