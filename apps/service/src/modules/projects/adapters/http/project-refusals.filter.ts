import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ProjectRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import { ProjectRefused } from "../../domain/project-refused.js";

/** Answers the Projects' own refusals as Nest answers its errors, with `message` for the web. */
@Catch(ProjectRefused, ProjectNotFound)
export class ProjectRefusalsFilter implements ExceptionFilter<ProjectRefused | ProjectNotFound> {
  catch(error: ProjectRefused | ProjectNotFound, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof ProjectNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: ProjectRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
