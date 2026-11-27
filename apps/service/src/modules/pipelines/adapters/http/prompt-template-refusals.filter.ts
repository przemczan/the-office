import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { PromptTemplateRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { PromptTemplateNotFound, PromptTemplateRefused } from "../../../prompt-templates/index.js";

/**
 * Answers the Prompt templates' refusals of a save or a reset as Prompt templates' own routes
 * answer them, with `message` for the web.
 */
@Catch(PromptTemplateRefused, PromptTemplateNotFound)
export class PromptTemplateActionRefusalsFilter implements ExceptionFilter<
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
