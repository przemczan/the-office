import type { IncomingMessage } from "node:http";
import {
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isSignInUnchecked, SIGN_IN_FIRST, signedInOfRequest } from "./signed-in-requests.js";

const OPEN_WITHOUT_SIGN_IN = "the-office:open-without-sign-in";

/**
 * Marks a controller or one of its routes as reached without a signed-in device (spec §2.10, "What
 * every request needs"): the sign-in pages and their callbacks, the download links of Build to
 * install files, `/api/health` and the Claude Code `-p` hook, which checks its own token. Every
 * other route needs one.
 */
export const OpenWithoutSignIn = (): ClassDecorator & MethodDecorator =>
  SetMetadata(OPEN_WITHOUT_SIGN_IN, true);

/**
 * The sign-in guard, global through `RequestAccessModule`: every route needs a signed-in device,
 * from localhost too, unless it is marked `@OpenWithoutSignIn()`. It reads the route Nest matched,
 * so it can't see a path other than the one routed. Who signed in was looked up before the body was
 * read (`identifySignedIn`); a lookup that failed answers 503.
 */
@Injectable()
export class SignInGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const open = this.reflector.getAllAndOverride<boolean | undefined>(OPEN_WITHOUT_SIGN_IN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (open === true) return true;
    const request = context.switchToHttp().getRequest<IncomingMessage>();
    if (signedInOfRequest(request) !== undefined) return true;
    if (isSignInUnchecked(request)) {
      throw new ServiceUnavailableException("The Office could not check who is signed in.");
    }
    throw new UnauthorizedException(SIGN_IN_FIRST);
  }
}
