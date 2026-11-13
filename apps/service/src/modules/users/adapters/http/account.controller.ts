import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import {
  appearanceSchema,
  passwordChangeSchema,
  profileChangeSchema,
  type Account,
  type Appearance as AppearanceMessage,
  type PasswordChange,
  type ProfileChange,
  type SignedInDevice as SignedInDeviceMessage,
} from "@the-office/contracts";
import type { Request, Response } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { Accounts } from "../../application/accounts.js";
import { SignedInDevices } from "../../application/signed-in-devices.js";
import type { SignedInDevice } from "../../domain/signed-in-device.js";
import type { Appearance, User } from "../../domain/user.js";
import { clearedSignInCookie } from "./sign-in-cookie.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/**
 * The signed-in user's account (spec §2.10): their profile, password, appearance and signed-in
 * devices, and Sign out.
 */
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
    return accountOf(user);
  }

  @Patch("account")
  async changeProfile(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(profileChangeSchema)) change: ProfileChange,
  ): Promise<Account> {
    return accountOf(await this.accounts.changeProfile(userId, change));
  }

  /** Changes the password and signs out every other device of the user. */
  @Post("account/password")
  @HttpCode(204)
  async changePassword(
    @SignedIn() { userId, signedInDeviceId }: SignedIn,
    @Body(new ContractPipe(passwordChangeSchema)) change: PasswordChange,
  ): Promise<void> {
    await this.accounts.changePassword(userId, signedInDeviceId, change);
  }

  @Put("account/appearance")
  async setAppearance(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(appearanceSchema)) appearance: AppearanceMessage,
  ): Promise<Account> {
    return accountOf(
      await this.accounts.setAppearance(userId, {
        palette: appearance.palette ?? undefined,
        density: appearance.density ?? undefined,
      }),
    );
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

function accountOf(user: User): Account {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    appearance: appearanceMessageOf(user.appearance),
  };
}

/** The appearance as kept; an id the web no longer knows is answered as the default. */
function appearanceMessageOf({ palette, density }: Appearance): AppearanceMessage {
  const known = appearanceSchema.safeParse({ palette: palette ?? null, density: density ?? null });
  return known.success ? known.data : { palette: null, density: null };
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
