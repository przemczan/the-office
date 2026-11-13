import type { IncomingMessage } from "node:http";
import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Unsubscribe } from "../events/event-bus.js";

/** Who signed a request in: the user, and the signed-in device the request came from. */
export interface SignedIn {
  readonly userId: string;
  readonly signedInDeviceId: string;
}

/**
 * Tells which signed-in device a request comes from (spec §2.10). Bound in `app.module.ts` to the
 * users module through `RequestAccessModule`, so the platform's guard and the WebSocket never
 * import a module.
 */
export abstract class SignedInRequests {
  /** The user and signed-in device the request's cookie names, while it is signed in. */
  abstract signedInOf(request: IncomingMessage): Promise<SignedIn | undefined>;

  /** Calls `listener` with the ids of each set of signed-in devices signed out, until unsubscribed. */
  abstract onSignedOut(listener: (signedInDeviceIds: readonly string[]) => void): Unsubscribe;

  /**
   * Of these signed-in devices, the ones no longer signed in, including those `onSignedOut` never
   * tells of: signed out by another process, such as the host's recovery command, or expired.
   */
  abstract signedOutAmong(signedInDeviceIds: readonly string[]): Promise<readonly string[]>;
}

const signedInRequests = new WeakMap<IncomingMessage, SignedIn>();

/** Kept by the guard for the request it let through, for `@SignedIn()`. */
export function rememberSignedIn(request: IncomingMessage, signedIn: SignedIn): void {
  signedInRequests.set(request, signedIn);
}

/** Who the guard found signed the request in; undefined on the routes it leaves open. */
export function signedInOfRequest(request: IncomingMessage): SignedIn | undefined {
  return signedInRequests.get(request);
}

/**
 * The user and signed-in device behind a request, as a controller's parameter. Only on a route the
 * guard checks: on one it leaves open (`/api/sign-in/**`) nobody is known, and this answers 401.
 */
export const SignedIn = createParamDecorator((_: unknown, context: ExecutionContext): SignedIn => {
  const signedIn = signedInOfRequest(context.switchToHttp().getRequest<IncomingMessage>());
  if (signedIn === undefined) throw new UnauthorizedException(SIGN_IN_FIRST);
  return signedIn;
});

export const SIGN_IN_FIRST = "Sign in to The Office first.";
