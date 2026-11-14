import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseFilters,
} from "@nestjs/common";
import {
  newPasskeySchema,
  passkeyAddingSchema,
  passkeyCreationOptionsSchema,
  passkeyRenameSchema,
  type NewPasskey,
  type Passkey as PasskeyMessage,
  type PasskeyAdding,
  type PasskeyCreationOptions,
  type PasskeyList,
  type PasskeyRename,
} from "@the-office/contracts";
import type { Request } from "express";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { Passkeys } from "../../application/passkeys.js";
import { PASSKEY_WAY } from "../../domain/sign-in-way.js";
import { ceremonyAnswerOf, passkeyMessageOf } from "./passkey-messages.js";
import { pageAddressOf } from "./sign-in-request.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/**
 * The signed-in user's passkeys, on their account (spec §2.10): listed with where each works,
 * added at this page's address after the current password, renamed and removed.
 */
@Controller("account/passkeys")
@UseFilters(UserRefusalsFilter)
export class PasskeysController {
  constructor(
    private readonly passkeys: Passkeys,
    private readonly officeAddresses: OfficeAddresses,
  ) {}

  @Get()
  async list(@SignedIn() { userId }: SignedIn, @Req() request: Request): Promise<PasskeyList> {
    const page = pageAddressOf(request, this.officeAddresses);
    const passkeys = await this.passkeys.listOf(userId);
    return {
      passkeys: passkeys.map((passkey) => passkeyMessageOf(passkey, page)),
      addingUnavailable: PASSKEY_WAY.unavailableAt(page) ?? null,
    };
  }

  /** Starts adding a passkey here, once the current password is the user's. */
  @Post("options")
  @HttpCode(200)
  async options(
    @SignedIn() { userId, signedInDeviceId }: SignedIn,
    @Body(new ContractPipe(passkeyAddingSchema)) { currentPassword }: PasskeyAdding,
    @Req() request: Request,
  ): Promise<PasskeyCreationOptions> {
    const options = await this.passkeys.startAdding(
      userId,
      signedInDeviceId,
      currentPassword,
      pageAddressOf(request, this.officeAddresses),
    );
    return passkeyCreationOptionsSchema.parse(options);
  }

  @Post()
  async add(
    @SignedIn() { userId, signedInDeviceId }: SignedIn,
    @Body(new ContractPipe(newPasskeySchema)) { name, registration }: NewPasskey,
    @Req() request: Request,
  ): Promise<PasskeyMessage> {
    const page = pageAddressOf(request, this.officeAddresses);
    const passkey = await this.passkeys.finishAdding(
      userId,
      signedInDeviceId,
      name,
      ceremonyAnswerOf(registration),
      page,
    );
    return passkeyMessageOf(passkey, page);
  }

  @Patch(":id")
  async rename(
    @SignedIn() { userId }: SignedIn,
    @Param("id") id: string,
    @Body(new ContractPipe(passkeyRenameSchema)) { name }: PasskeyRename,
    @Req() request: Request,
  ): Promise<PasskeyMessage> {
    const passkey = await this.passkeys.rename(userId, id, name);
    return passkeyMessageOf(passkey, pageAddressOf(request, this.officeAddresses));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@SignedIn() { userId }: SignedIn, @Param("id") id: string): Promise<void> {
    await this.passkeys.remove(userId, id);
  }
}
