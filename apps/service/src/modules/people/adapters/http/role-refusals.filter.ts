import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { RoleRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { RoleRefused } from "../../domain/role-refused.js";

/** Answers People's own refusals as Nest answers its errors, with `message` for the web. */
@Catch(RoleRefused, RoleNotFound)
export class RoleRefusalsFilter implements ExceptionFilter<RoleRefused | RoleNotFound> {
  catch(error: RoleRefused | RoleNotFound, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof RoleNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: RoleRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
