import { Body, Controller, Get, HttpCode, Param, Post, UseFilters } from "@nestjs/common";
import {
  engineSignInCodeSchema,
  type EngineAccount as EngineAccountResponse,
  type EngineSignIn,
  type EngineSignInCode,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { EngineAccounts } from "../../application/engine-accounts.js";
import type { EngineAccount } from "../../domain/engine-account.js";
import { EngineAccountRefusalFilter } from "./engine-account-refusal.filter.js";

/** Settings › Engines: a Claude Code engine's account and its Sign in. */
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
}

function accountResponse(account: EngineAccount): EngineAccountResponse {
  if (!account.signedIn) return { signedIn: false, email: null, plan: null };
  return { signedIn: true, email: account.email ?? null, plan: account.plan ?? null };
}
