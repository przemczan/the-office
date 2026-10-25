import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { ThreadRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { ChatNotFound } from "../../domain/chat-not-found.js";
import { DecisionNotFound } from "../../domain/decision-not-found.js";
import { ThreadNotFound } from "../../domain/thread-not-found.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

type ConversationsError = ThreadRefused | ThreadNotFound | ChatNotFound | DecisionNotFound;

/** Answers Conversations' own refusals as Nest answers its errors, with `message` for the web. */
@Catch(ThreadRefused, ThreadNotFound, ChatNotFound, DecisionNotFound)
export class ThreadRefusalsFilter implements ExceptionFilter<ConversationsError> {
  catch(error: ConversationsError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (!(error instanceof ThreadRefused)) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        message: error.message,
      });
      return;
    }
    const refusal: ThreadRefusal = {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: error.message,
      reasons: [...error.reasons],
    };
    response.status(refusal.statusCode).json(refusal);
  }
}
