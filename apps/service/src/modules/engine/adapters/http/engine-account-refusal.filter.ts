import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import {
  NotAClaudeCodeEngine,
  NotACodexEngine,
  NotAnEngineWithAnAccount,
} from "../../application/engine-accounts.js";
import { NotACodexApiKey } from "../../domain/codex-api-key.js";
import { EngineAccountUnreadable } from "../../domain/engine-account.js";
import { NotAPastedToken } from "../../domain/pasted-token.js";
import { SignInFailed, SignInNotRunning } from "../../ports/claude-code-accounts.js";
import { CodexLoginFailed } from "../../ports/codex-accounts.js";

type AccountRefusal =
  | NotAClaudeCodeEngine
  | NotACodexEngine
  | NotAnEngineWithAnAccount
  | NotAPastedToken
  | NotACodexApiKey
  | SignInNotRunning
  | SignInFailed
  | CodexLoginFailed
  | EngineAccountUnreadable;

/** Answers a refused account request as Nest answers its errors, in words for the web. */
@Catch(
  NotAClaudeCodeEngine,
  NotACodexEngine,
  NotAnEngineWithAnAccount,
  NotAPastedToken,
  NotACodexApiKey,
  SignInNotRunning,
  SignInFailed,
  CodexLoginFailed,
  EngineAccountUnreadable,
)
export class EngineAccountRefusalFilter implements ExceptionFilter<AccountRefusal> {
  catch(error: AccountRefusal, host: ArgumentsHost): void {
    const statusCode = statusOf(error);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(statusCode)
      .json({ statusCode, message: error.message });
  }
}

function statusOf(error: AccountRefusal): HttpStatus {
  if (
    error instanceof NotAClaudeCodeEngine ||
    error instanceof NotACodexEngine ||
    error instanceof NotAnEngineWithAnAccount
  ) {
    return HttpStatus.NOT_FOUND;
  }
  if (error instanceof NotAPastedToken || error instanceof NotACodexApiKey) {
    return HttpStatus.BAD_REQUEST;
  }
  if (error instanceof SignInNotRunning) return HttpStatus.CONFLICT;
  // The binary failed, not the request; its words never hold a key.
  return HttpStatus.BAD_GATEWAY;
}
