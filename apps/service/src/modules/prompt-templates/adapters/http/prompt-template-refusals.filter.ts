import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { PromptTemplateRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { PromptTemplateNotFound } from "../../domain/prompt-template-not-found.js";
import { PromptTemplateRefused } from "../../domain/prompt-template-refused.js";

/** Answers the templates' own refusals as Nest answers its errors, with `message` for the web. */
@Catch(PromptTemplateRefused, PromptTemplateNotFound)
export class PromptTemplateRefusalsFilter implements ExceptionFilter<
  PromptTemplateRefused | PromptTemplateNotFound
> {
  catch(error: PromptTemplateRefused | PromptTemplateNotFound, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof PromptTemplateNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: PromptTemplateRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
      problems: [...error.problems],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
