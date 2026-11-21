import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { PullRequestRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { PullRequestNotFound, PullRequestRefused } from "../../domain/pull-request-refused.js";
import { TestInstanceRefused } from "../../domain/test-instance-refused.js";

/**
 * Answers a refused merge or close 409 with `{ reason, refresh }` (a test instance of The Office's
 * refusal among them, with nothing to refresh) and a pull request not kept 404, as the user's
 * answer and never logged as an error.
 */
@Catch(PullRequestRefused, PullRequestNotFound, TestInstanceRefused)
export class PullRequestRefusalsFilter implements ExceptionFilter<
  PullRequestRefused | PullRequestNotFound | TestInstanceRefused
> {
  catch(
    error: PullRequestRefused | PullRequestNotFound | TestInstanceRefused,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof PullRequestNotFound) {
      response
        .status(HttpStatus.NOT_FOUND)
        .json({ statusCode: HttpStatus.NOT_FOUND, message: error.message });
      return;
    }
    const refusal: PullRequestRefusal =
      error instanceof TestInstanceRefused
        ? { reason: error.message, refresh: false }
        : { reason: error.reason, refresh: error.refresh };
    response.status(HttpStatus.CONFLICT).json(refusal);
  }
}
