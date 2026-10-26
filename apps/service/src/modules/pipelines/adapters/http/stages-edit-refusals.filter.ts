import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { StagesEditRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { StagesEditRefused } from "../../domain/stages-edit-refused.js";

/** Answers a refused edit of a Task's Stages as Nest answers its errors, with every problem. */
@Catch(StagesEditRefused)
export class StagesEditRefusalsFilter implements ExceptionFilter<StagesEditRefused> {
  catch(error: StagesEditRefused, host: ArgumentsHost): void {
    const refusal: StagesEditRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      problems: error.problems.map(({ stageIndex, text }) => ({
        stageIndex: stageIndex ?? null,
        text,
      })),
    };
    host.switchToHttp().getResponse<Response>().status(refusal.statusCode).json(refusal);
  }
}
