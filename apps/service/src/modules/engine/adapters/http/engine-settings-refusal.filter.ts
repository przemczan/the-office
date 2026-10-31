import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { EngineSettingsRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { EngineSettingsRefused } from "../../domain/engine-settings-refused.js";

/** Answers refused engine settings as Nest answers its errors, with every reason for the web. */
@Catch(EngineSettingsRefused)
export class EngineSettingsRefusalFilter implements ExceptionFilter<EngineSettingsRefused> {
  catch(error: EngineSettingsRefused, host: ArgumentsHost): void {
    const refusal: EngineSettingsRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    host.switchToHttp().getResponse<Response>().status(refusal.statusCode).json(refusal);
  }
}
