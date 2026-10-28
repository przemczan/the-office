import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { WorkRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { AttachmentNotFound } from "../../domain/attachment-not-found.js";
import { AttachmentRefused } from "../../domain/attachment-refused.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { IdeaRefused } from "../../domain/idea-refused.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import { InitiativeRefused } from "../../domain/initiative-refused.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { TaskRefused } from "../../domain/task-refused.js";

type WorkRefused = IdeaRefused | InitiativeRefused | TaskRefused | AttachmentRefused;
type WorkNotFound = IdeaNotFound | InitiativeNotFound | TaskNotFound | AttachmentNotFound;

/** Answers Work's own refusals as Nest answers its errors, with `message` for the web. */
@Catch(
  IdeaRefused,
  InitiativeRefused,
  TaskRefused,
  AttachmentRefused,
  IdeaNotFound,
  InitiativeNotFound,
  TaskNotFound,
  AttachmentNotFound,
)
export class WorkRefusalsFilter implements ExceptionFilter<WorkRefused | WorkNotFound> {
  catch(error: WorkRefused | WorkNotFound, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (!("reasons" in error)) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: WorkRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
