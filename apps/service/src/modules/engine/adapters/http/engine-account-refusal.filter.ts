import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { NotAClaudeCodeEngine } from "../../application/engine-accounts.js";
import { EngineAccountUnreadable } from "../../domain/engine-account.js";
import { SignInFailed, SignInNotRunning } from "../../ports/claude-code-accounts.js";

type AccountRefusal =
  NotAClaudeCodeEngine | SignInNotRunning | SignInFailed | EngineAccountUnreadable;

/** Answers a refused account request as Nest answers its errors, in words for the web. */
@Catch(NotAClaudeCodeEngine, SignInNotRunning, SignInFailed, EngineAccountUnreadable)
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
  if (error instanceof NotAClaudeCodeEngine) return HttpStatus.NOT_FOUND;
  if (error instanceof SignInNotRunning) return HttpStatus.CONFLICT;
  // The binary failed, not the request.
  return HttpStatus.BAD_GATEWAY;
}
