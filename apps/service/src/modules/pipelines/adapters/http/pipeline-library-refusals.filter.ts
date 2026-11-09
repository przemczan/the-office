import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { PipelineRemovalRefusal } from "@the-office/contracts";
import type { Response } from "express";
import {
  PipelineRemovalRefused,
  UnknownPipeline,
  UnknownStageTemplate,
} from "../../domain/pipeline-library-refusals.js";

type LibraryRefusal = PipelineRemovalRefused | UnknownPipeline | UnknownStageTemplate;

/**
 * Answers the library's refusals, of its Pipelines and its Stage templates, as Nest answers its
 * errors, with `message` for the web.
 */
@Catch(PipelineRemovalRefused, UnknownPipeline, UnknownStageTemplate)
export class PipelineLibraryRefusalsFilter implements ExceptionFilter<LibraryRefusal> {
  catch(error: LibraryRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof UnknownPipeline || error instanceof UnknownStageTemplate) {
      response
        .status(HttpStatus.NOT_FOUND)
        .json({ statusCode: HttpStatus.NOT_FOUND, message: error.message });
      return;
    }
    const refusal: PipelineRemovalRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
