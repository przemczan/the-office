import type { IncomingMessage } from "node:http";
import { createParamDecorator, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Unsubscribe } from "../events/event-bus.js";

/** A user as the records they make name them: their id, and their name as it is now. */
export interface SignedInUser {
  readonly userId: string;
  readonly name: string;
}

/** Who signed a request in: the user, and the signed-in device the request came from. */
export interface SignedIn extends SignedInUser {
  readonly signedInDeviceId: string;
}

/** The user of a signed-in request alone, for a record to keep, without their device. */
export function userOf({ userId, name }: SignedIn): SignedInUser {
  return { userId, name };
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

/** What `identifySignedIn` found of a request: who signed it in, or that nobody could be checked. */
type SignInCheck = SignedIn | typeof UNCHECKED;

const UNCHECKED = "unchecked";

const checkedRequests = new WeakMap<IncomingMessage, SignInCheck>();

/** Kept by `identifySignedIn` for a request a signed-in device sent, for the guard and `@SignedIn()`. */
export function rememberSignedIn(request: IncomingMessage, signedIn: SignedIn): void {
  checkedRequests.set(request, signedIn);
}

/** Kept by `identifySignedIn` when who signed the request in couldn't be checked. */
export function rememberSignInUnchecked(request: IncomingMessage): void {
  checkedRequests.set(request, UNCHECKED);
}

/** Who signed the request in; undefined when nobody did, or it couldn't be checked. */
export function signedInOfRequest(request: IncomingMessage): SignedIn | undefined {
  const checked = checkedRequests.get(request);
  return checked === UNCHECKED ? undefined : checked;
}

/** Whether who signed the request in couldn't be checked, such as with the database down. */
export function isSignInUnchecked(request: IncomingMessage): boolean {
  return checkedRequests.get(request) === UNCHECKED;
}

/**
 * The user and signed-in device behind a request, as a controller's parameter. On a route open
 * without sign-in (`@OpenWithoutSignIn()`) a request may come from nobody, and this answers 401.
 */
export const SignedIn = createParamDecorator((_: unknown, context: ExecutionContext): SignedIn => {
  const signedIn = signedInOfRequest(context.switchToHttp().getRequest<IncomingMessage>());
  if (signedIn === undefined) throw new UnauthorizedException(SIGN_IN_FIRST);
  return signedIn;
});

export const SIGN_IN_FIRST = "Sign in to The Office first.";
