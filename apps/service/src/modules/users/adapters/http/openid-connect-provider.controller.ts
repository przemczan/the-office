import { Body, Controller, Delete, Get, HttpCode, Put, UseFilters } from "@nestjs/common";
import {
  saveOpenIdConnectProviderSchema,
  type OpenIdConnectProvider,
  type OpenIdConnectProviderSetting,
  type SaveOpenIdConnectProvider,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { OpenIdConnectProviders } from "../../application/openid-connect-providers.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/**
 * The OpenID Connect provider, on Settings › Signing in (spec §2.10): any signed-in user reads,
 * saves and removes it. No answer ever holds its secret, only whether one is saved.
 */
@Controller("settings/openid-connect-provider")
@UseFilters(UserRefusalsFilter)
export class OpenIdConnectProviderController {
  constructor(private readonly openIdConnectProviders: OpenIdConnectProviders) {}

  @Get()
  async setting(): Promise<OpenIdConnectProviderSetting> {
    return { provider: (await this.openIdConnectProviders.shown()) ?? null };
  }

  @Put()
  save(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(saveOpenIdConnectProviderSchema)) entry: SaveOpenIdConnectProvider,
  ): Promise<OpenIdConnectProvider> {
    return this.openIdConnectProviders.save(userId, entry);
  }

  @Delete()
  @HttpCode(204)
  async remove(@SignedIn() { userId }: SignedIn): Promise<void> {
    await this.openIdConnectProviders.remove(userId);
  }
}
