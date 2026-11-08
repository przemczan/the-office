import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ProjectRefusal } from "@the-office/contracts";
import type { Response } from "express";
import {
  RunEnvironmentProjectNotFound,
  RunEnvironmentSettingRefused,
} from "../../domain/run-environment-setting-refused.js";

type RunEnvironmentRefusal = RunEnvironmentSettingRefused | RunEnvironmentProjectNotFound;

/** Answers as the Projects' routes answer: 422 with every reason, or 404 for no such Project. */
@Catch(RunEnvironmentSettingRefused, RunEnvironmentProjectNotFound)
export class RunEnvironmentRefusalsFilter implements ExceptionFilter<RunEnvironmentRefusal> {
  catch(error: RunEnvironmentRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof RunEnvironmentProjectNotFound) {
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
