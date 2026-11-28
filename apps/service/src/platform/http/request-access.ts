import type { IncomingMessage, ServerResponse } from "node:http";
import { isAmbiguousPath, isApiPath } from "./api-path.js";
import type { OfficeAddresses } from "./office-addresses.js";
import {
  rememberSignedIn,
  rememberSignInUnchecked,
  type SignedInRequests,
} from "./signed-in-requests.js";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

/** Answers 403 to every request the Host and Origin checks refuse (spec §5.1). */
export function refuseNonLocalRequests(addresses: OfficeAddresses): Middleware {
  return (request, response, next) => {
    const refusal = addresses.refusal(request);
    if (refusal === undefined) next();
    else answer(response, 403, refusal, "Forbidden");
  };
}

/**
 * Answers 400 to a request whose path a browser never sends (`isAmbiguousPath`), before anything
 * reads the path: WHATWG URL parsing and Express's routing would each read it as another path.
 */
export function refuseAmbiguousPaths(): Middleware {
  return (request, response, next) => {
    if (isAmbiguousPath(request.url ?? "/")) {
      answer(response, 400, "The Office doesn't answer this address.", "Bad Request");
    } else next();
  };
}

/**
 * Looks up who signed in each API request, localhost's included, before its body is read, and
 * keeps it for the sign-in guard (`SignInGuard`), `@SignedIn()` and the body's size limit. A lookup
 * that fails is kept as unchecked, which the guard answers with 503 on a route that needs a
 * signed-in device; the open ones, `/api/health` among them, still answer. The web app's own files
 * are never looked up for.
 */
export function identifySignedIn(signedInRequests: SignedInRequests): Middleware {
  return (request, _response, next) => {
    if (!isApiPath(request.url ?? "/")) {
      next();
      return;
    }
    // oxlint-disable-next-line office/caught-voided-calls -- identifying never rejects, and Express catches what the next handler throws
    void identify(signedInRequests, request, next);
  };
}

async function identify(
  signedInRequests: SignedInRequests,
  request: IncomingMessage,
  next: () => void,
): Promise<void> {
  try {
    const signedIn = await signedInRequests.signedInOf(request);
    if (signedIn !== undefined) rememberSignedIn(request, signedIn);
  } catch {
    rememberSignInUnchecked(request);
  }
  next();
}

function answer(
  response: ServerResponse,
  statusCode: number,
  message: string,
  error: string,
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ statusCode, message, error }));
}
