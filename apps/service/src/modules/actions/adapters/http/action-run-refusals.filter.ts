import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { ActionRunNotFound, ActionRunRefused } from "../../domain/action-run-refused.js";

type ActionRunsRefusal = ActionRunRefused | ActionRunNotFound;

/**
 * A refused start, stop or settings change answers 409 with every reason, joined into `message`
 * for the web's toast; no such run, Action or Project answers 404.
 */
@Catch(ActionRunRefused, ActionRunNotFound)
export class ActionRunRefusalsFilter implements ExceptionFilter<ActionRunsRefusal> {
  catch(error: ActionRunsRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof ActionRunNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    response.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      message: error.message,
      reasons: [...error.reasons],
    });
  }
}
