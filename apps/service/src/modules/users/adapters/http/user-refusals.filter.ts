import {
  Catch,
  HttpStatus,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { SignInRefusal, UserRefusal } from "@the-office/contracts";
import type { Response } from "express";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import { SignInRefused } from "../../domain/sign-in-refused.js";
import {
  FirstUserExists,
  PendingSignInEnded,
  SignedInDeviceNotFound,
  UserRefused,
} from "../../domain/user-refused.js";

type UsersRefusal =
  SignInRefused | UserRefused | FirstUserExists | PendingSignInEnded | SignedInDeviceNotFound;

/** Answers the users module's own refusals as Nest answers its errors, with `message` for the web. */
@Catch(SignInRefused, UserRefused, FirstUserExists, PendingSignInEnded, SignedInDeviceNotFound)
@Injectable()
export class UserRefusalsFilter implements ExceptionFilter<UsersRefusal> {
  constructor(private readonly schedule: Schedule) {}

  catch(error: UsersRefusal, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof SignInRefused) {
      answerSignInRefused(response, error, this.schedule.now());
      return;
    }
    if (error instanceof UserRefused) {
      const refusal: UserRefusal = {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        message: error.message,
        reasons: [...error.reasons],
      };
      response.status(refusal.statusCode).json(refusal);
      return;
    }
    const statusCode = statusCodeOf(error);
    response.status(statusCode).json({ statusCode, message: error.message });
  }
}

function statusCodeOf(
  error: FirstUserExists | PendingSignInEnded | SignedInDeviceNotFound,
): HttpStatus {
  if (error instanceof FirstUserExists) return HttpStatus.CONFLICT;
  // Not signed in after all: the code page sends the user back to sign in.
  if (error instanceof PendingSignInEnded) return HttpStatus.UNAUTHORIZED;
  return HttpStatus.NOT_FOUND;
}

/** A wrong try answers 422; a try not taken, for the slow-down or the lockout, 429. */
function answerSignInRefused(response: Response, error: SignInRefused, now: Date): void {
  const statusCode =
    error.refusal === "wrong" ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.TOO_MANY_REQUESTS;
  const { tryAgainAt } = error;
  if (statusCode === HttpStatus.TOO_MANY_REQUESTS && tryAgainAt !== undefined) {
    const seconds = Math.max(1, Math.ceil((tryAgainAt.getTime() - now.getTime()) / 1000));
    response.setHeader("Retry-After", String(seconds));
  }
  const refusal: SignInRefusal = {
    statusCode,
    message: error.message,
    refusal: error.refusal,
    ...(tryAgainAt && { tryAgainAt: tryAgainAt.toISOString() }),
  };
  response.status(statusCode).json(refusal);
}
