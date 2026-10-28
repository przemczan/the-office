import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { PipelineRemovalRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { PipelineRemovalRefused, UnknownPipeline } from "../../domain/pipeline-library-refusals.js";

/** Answers the library editor's refusals as Nest answers its errors, with `message` for the web. */
@Catch(PipelineRemovalRefused, UnknownPipeline)
export class PipelineLibraryRefusalsFilter implements ExceptionFilter<
  PipelineRemovalRefused | UnknownPipeline
> {
  catch(error: PipelineRemovalRefused | UnknownPipeline, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof UnknownPipeline) {
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
