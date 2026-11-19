import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseFilters,
} from "@nestjs/common";
import {
  engineApiKeySchema,
  engineSignInCodeSchema,
  engineTokenSchema,
  type EngineAccount as EngineAccountResponse,
  type EngineApiKey,
  type EngineSignIn,
  type EngineSignInCode,
  type EngineToken,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineAccounts } from "../../application/engine-accounts.js";
import type { EngineAccount } from "../../domain/engine-account.js";
import { EngineAccountRefusalFilter } from "./engine-account-refusal.filter.js";

/**
 * Settings › Engines: a Claude Code, Codex or Copilot CLI engine's account, its Sign in and Sign
 * out, a pasted token on a Claude Code or Copilot CLI engine and an API key on a Claude Code or
 * Codex engine.
 */
@Controller("settings/engines/:engineId")
@UseFilters(EngineAccountRefusalFilter)
export class EngineAccountsController {
  constructor(private readonly accounts: EngineAccounts) {}

  @Get("account")
  async account(@Param("engineId") engineId: string): Promise<EngineAccountResponse> {
    return accountResponse(await this.accounts.account(engineId));
  }

  @Post("sign-in")
  @HttpCode(200)
  async signIn(@Param("engineId") engineId: string): Promise<EngineSignIn> {
    const { url, userCode } = await this.accounts.signIn(engineId);
    return userCode === undefined ? { url } : { url, userCode };
  }

  @Post("sign-in/code")
  @HttpCode(204)
  async enterCode(
    @Param("engineId") engineId: string,
    @Body(new ContractPipe(engineSignInCodeSchema)) { code }: EngineSignInCode,
  ): Promise<void> {
    await this.accounts.enterCode(engineId, code);
  }

  /** The token is never answered back, nor named in a refusal; its shape is the engine's kind's. */
  @Put("token")
  @HttpCode(204)
  async setPastedToken(
    @Param("engineId") engineId: string,
    @Body(new ContractPipe(engineTokenSchema)) { token }: EngineToken,
  ): Promise<void> {
    await this.accounts.setPastedToken(engineId, token);
  }

  /** The key is never answered back, nor named in a refusal; its shape is the engine's kind's. */
  @Put("api-key")
  @HttpCode(204)
  async setApiKey(
    @Param("engineId") engineId: string,
    @Body(new ContractPipe(engineApiKeySchema)) { key }: EngineApiKey,
  ): Promise<void> {
    await this.accounts.setApiKey(engineId, key);
  }

  @Delete("sign-in")
  @HttpCode(204)
  async signOut(@Param("engineId") engineId: string): Promise<void> {
    await this.accounts.signOut(engineId);
  }
}

function accountResponse(account: EngineAccount): EngineAccountResponse {
  if (!account.signedIn) {
    return { signedIn: false, pastedToken: false, apiKey: false, email: null, plan: null };
  }
  return {
    signedIn: true,
    pastedToken: account.pastedToken,
    apiKey: account.apiKey,
    email: account.email ?? null,
    plan: account.plan ?? null,
  };
}
