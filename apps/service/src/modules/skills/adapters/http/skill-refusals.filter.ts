import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { SkillRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { SkillNotFound } from "../../domain/skill-not-found.js";
import { SkillRefused } from "../../domain/skill-refused.js";

/** Answers the library's own refusals as Nest answers its errors, with `message` for the web. */
@Catch(SkillRefused, SkillNotFound)
export class SkillRefusalsFilter implements ExceptionFilter<SkillRefused | SkillNotFound> {
  catch(error: SkillRefused | SkillNotFound, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof SkillNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: SkillRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
