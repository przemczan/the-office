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
  enginePastedTokenSchema,
  engineSignInCodeSchema,
  type EngineAccount as EngineAccountResponse,
  type EnginePastedToken,
  type EngineSignIn,
  type EngineSignInCode,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineAccounts } from "../../application/engine-accounts.js";
import type { EngineAccount } from "../../domain/engine-account.js";
import { PastedToken } from "../../domain/pasted-token.js";
import { EngineAccountRefusalFilter } from "./engine-account-refusal.filter.js";

/** Settings › Engines: a Claude Code engine's account, its Sign in, a pasted token and Sign out. */
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
    return { url: await this.accounts.signIn(engineId) };
  }

  @Post("sign-in/code")
  @HttpCode(204)
  async enterCode(
    @Param("engineId") engineId: string,
    @Body(new ContractPipe(engineSignInCodeSchema)) { code }: EngineSignInCode,
  ): Promise<void> {
    await this.accounts.enterCode(engineId, code);
  }

  /** The token is never answered back, nor named in a refusal. */
  @Put("token")
  @HttpCode(204)
  async setPastedToken(
    @Param("engineId") engineId: string,
    @Body(new ContractPipe(enginePastedTokenSchema)) { token }: EnginePastedToken,
  ): Promise<void> {
    await this.accounts.setPastedToken(engineId, PastedToken.of(token));
  }

  @Delete("sign-in")
  @HttpCode(204)
  async signOut(@Param("engineId") engineId: string): Promise<void> {
    await this.accounts.signOut(engineId);
  }
}

function accountResponse(account: EngineAccount): EngineAccountResponse {
  if (!account.signedIn) return { signedIn: false, pastedToken: false, email: null, plan: null };
  return {
    signedIn: true,
    pastedToken: account.pastedToken,
    email: account.email ?? null,
    plan: account.plan ?? null,
  };
}
