import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { GateRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { GateRefused } from "../../domain/gate-refused.js";

/** Answers a refused Gate action as Nest answers its errors, with `message` for the web. */
@Catch(GateRefused)
export class GateRefusalsFilter implements ExceptionFilter<GateRefused> {
  catch(error: GateRefused, host: ArgumentsHost): void {
    const refusal: GateRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    host.switchToHttp().getResponse<Response>().status(refusal.statusCode).json(refusal);
  }
}
