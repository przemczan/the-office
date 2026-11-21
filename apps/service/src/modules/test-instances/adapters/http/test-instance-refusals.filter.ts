import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import { TestInstanceNotFound, TestInstanceRefused } from "../../domain/test-instance-refused.js";

type TestInstancesRefusal = TestInstanceRefused | TestInstanceNotFound;

/**
 * A refused launch or stop answers 409 with every reason, joined into `message` for the web's
 * toast; no such instance, Initiative or Project answers 404.
 */
@Catch(TestInstanceRefused, TestInstanceNotFound)
export class TestInstanceRefusalsFilter implements ExceptionFilter<TestInstancesRefusal> {
  catch(error: TestInstancesRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof TestInstanceNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    response.status(HttpStatus.CONFLICT).json({
      statusCode: HttpStatus.CONFLICT,
      message: error.message,
      reasons: [...error.reasons],
    });
  }
}
