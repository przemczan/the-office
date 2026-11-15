import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { OfficeUpdateRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { ScheduledExitRefused } from "../../domain/scheduled-exit-refused.js";

/** Answers a refused schedule or cancel as Nest answers its errors, with `message` for the web. */
@Catch(ScheduledExitRefused)
export class ScheduledExitRefusalsFilter implements ExceptionFilter<ScheduledExitRefused> {
  catch(error: ScheduledExitRefused, host: ArgumentsHost): void {
    const refusal: OfficeUpdateRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    host.switchToHttp().getResponse<Response>().status(refusal.statusCode).json(refusal);
  }
}
