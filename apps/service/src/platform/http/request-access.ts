import type { IncomingMessage, ServerResponse } from "node:http";
import { API_PATH } from "@the-office/contracts";
import { apiRoutePathOf, isApiPath } from "./api-path.js";
import type { OfficeAddresses } from "./office-addresses.js";
import { rememberSignedIn, SIGN_IN_FIRST, type SignedInRequests } from "./signed-in-requests.js";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

/**
 * The API paths a request reaches without a signed-in device (spec §2.10): the sign-in pages and
 * every way's callback, under `/api/sign-in`; `/api/health`, which says only whether the database
 * is up and whether this is a test instance of The Office; and the Claude Code `-p` hook, which checks its own token.
 */
const OPEN_PREFIX = `${API_PATH}/sign-in`;
const OPEN_PATHS: readonly string[] = [
  OPEN_PREFIX,
  `${API_PATH}/health`,
  `${API_PATH}/engine/claude-code-p/hook`,
];

/** Whether an API request needs a signed-in device; the web app's own files never do. */
export function needsSignIn(url: string): boolean {
  if (!isApiPath(url)) return false;
  const pathname = apiRoutePathOf(url);
  return !(OPEN_PATHS.includes(pathname) || pathname.startsWith(`${OPEN_PREFIX}/`));
}

/** Answers 403 to every request the Host and Origin checks refuse (spec §5.1). */
export function refuseNonLocalRequests(addresses: OfficeAddresses): Middleware {
  return (request, response, next) => {
    const refusal = addresses.refusal(request);
    if (refusal === undefined) next();
    else answer(response, 403, refusal, "Forbidden");
  };
}

/**
 * Answers 401 to every API request that needs a signed-in device and comes from none, localhost
 * included, and keeps who signed in the others for `@SignedIn()`.
 */
export function refuseSignedOutRequests(signedInRequests: SignedInRequests): Middleware {
  return (request, response, next) => {
    if (!needsSignIn(request.url ?? "/")) {
      next();
      return;
    }
    void passSignedIn(signedInRequests, request, response, next);
  };
}

async function passSignedIn(
  signedInRequests: SignedInRequests,
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): Promise<void> {
  let signedIn: Awaited<ReturnType<SignedInRequests["signedInOf"]>>;
  try {
    signedIn = await signedInRequests.signedInOf(request);
  } catch {
    answer(response, 503, "The Office could not check who is signed in.", "Unavailable");
    return;
  }
  if (signedIn === undefined) {
    answer(response, 401, SIGN_IN_FIRST, "Unauthorized");
    return;
  }
  rememberSignedIn(request, signedIn);
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
