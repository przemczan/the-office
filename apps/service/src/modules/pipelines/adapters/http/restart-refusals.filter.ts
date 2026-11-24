import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { GateRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { RestartRefused } from "../../domain/restart-refused.js";

/** Answers a refused Restart from… as a refused Gate action is, with `message` for the web. */
@Catch(RestartRefused)
export class RestartRefusalsFilter implements ExceptionFilter<RestartRefused> {
  catch(error: RestartRefused, host: ArgumentsHost): void {
    const refusal: GateRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    host.switchToHttp().getResponse<Response>().status(refusal.statusCode).json(refusal);
  }
}
