import { Body, Controller, Delete, Get, HttpCode, Put, UseFilters } from "@nestjs/common";
import {
  saveGoogleClientSchema,
  type GoogleClient,
  type GoogleClientSetting,
  type SaveGoogleClient,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { GoogleClients } from "../../application/google-clients.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/**
 * The Google OAuth client, on Settings › Signing in (spec §2.10): any signed-in user reads, saves
 * and removes it. No answer ever holds its secret, only whether one is saved.
 */
@Controller("settings/google-client")
@UseFilters(UserRefusalsFilter)
export class GoogleClientController {
  constructor(private readonly googleClients: GoogleClients) {}

  @Get()
  async setting(): Promise<GoogleClientSetting> {
    return { client: (await this.googleClients.shown()) ?? null };
  }

  @Put()
  save(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(saveGoogleClientSchema)) entry: SaveGoogleClient,
  ): Promise<GoogleClient> {
    return this.googleClients.save(userId, entry);
  }

  @Delete()
  @HttpCode(204)
  async remove(@SignedIn() { userId }: SignedIn): Promise<void> {
    await this.googleClients.remove(userId);
  }
}
