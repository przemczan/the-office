import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { McpServerRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { McpServerNotFound } from "../../domain/mcp-server-not-found.js";
import { McpServerRefused } from "../../domain/mcp-server-refused.js";

/** Answers the library's own refusals as Nest answers its errors, with `message` for the web. */
@Catch(McpServerRefused, McpServerNotFound)
export class McpServerRefusalsFilter implements ExceptionFilter<
  McpServerRefused | McpServerNotFound
> {
  catch(error: McpServerRefused | McpServerNotFound, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof McpServerNotFound) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: McpServerRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
