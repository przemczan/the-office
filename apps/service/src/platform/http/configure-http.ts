import type { INestApplication, NestApplicationOptions } from "@nestjs/common";
import { API_PATH } from "@the-office/contracts";
import express from "express";
import { recordRequests } from "../system-health/request-recording.js";
import { SystemHealthRecorder } from "../system-health/system-health-recorder.js";
import { OfficeAddresses } from "./office-addresses.js";
import { apiRoutePathOf } from "./api-path.js";
import { readOncePerRequest } from "./reads-per-request.js";
import {
  identifySignedIn,
  refuseAmbiguousPaths,
  refuseNonLocalRequests,
} from "./request-access.js";
import { securityHeaders } from "./security-headers.js";
import { SignedInRequests, signedInOfRequest } from "./signed-in-requests.js";

/**
 * How the service's Nest application is created, by the running service and the tests that serve
 * it. Closing ends every connection still open: Node's own close waits for each to finish a
 * request, and a browser keeps spare connections that never send one, so a page left open could
 * hold the shutdown forever (as could a WebSocket client that never answers the close).
 */
export const HTTP_APPLICATION_OPTIONS = {
  forceCloseConnections: true,
} as const satisfies NestApplicationOptions;

/**
 * The largest JSON body read from a signed-in device. An engine's hook call carries the tool call's
 * input whole, a Write's file among it, so the parser's 100 kB default would refuse large writes.
 */
const SIGNED_IN_JSON_LIMIT = "16mb";

/** The largest JSON body read from anyone else: a sign-in's fields, or a passkey's answer. */
const SIGNED_OUT_JSON_LIMIT = "64kb";

/** The routes open without sign-in that take large bodies: the Claude Code `-p` hook, as above. */
const LARGE_BODY_OPEN_PATHS: readonly string[] = [`${API_PATH}/engine/claude-code-p/hook`];

/**
 * HTTP settings shared by the running service and the tests that serve it, on the addresses and
 * signed-in devices `RequestAccessModule` binds: System health's request durations, when the app
 * has its recorder, then the security headers every response carries, the Host and Origin checks,
 * the refusal of ambiguous paths and the lookup of who signed in, all before a body is read, then
 * the JSON body, and after it each GET's read scope (`readOncePerRequest`). The sign-in guard,
 * `SignInGuard`, runs on the route Nest matched.
 */
export function configureHttp(app: INestApplication): void {
  // First, so a request's duration covers every middleware; only in an app with System health.
  const systemHealth = systemHealthRecorderOf(app);
  if (systemHealth) app.use(recordRequests(systemHealth));
  app.use(securityHeaders());
  app.use(refuseNonLocalRequests(app.get(OfficeAddresses)));
  app.use(refuseAmbiguousPaths());
  app.use(identifySignedIn(app.get(SignedInRequests)));
  app.use(jsonBody());
  // After the body parser, whose callbacks would run outside the scope.
  app.use(readOncePerRequest());
  app.setGlobalPrefix(API_PATH);
}

/**
 * The JSON parser, its limit by who sent the request: a body that needs no signed-in device to be
 * read is kept small. Named `jsonParser`, as Nest adds no JSON parser of its own once one by that
 * name is in place.
 */
function jsonBody(): express.RequestHandler {
  const signedIn = express.json({ limit: SIGNED_IN_JSON_LIMIT });
  const signedOut = express.json({ limit: SIGNED_OUT_JSON_LIMIT });
  return function jsonParser(request, response, next) {
    const large =
      signedInOfRequest(request) !== undefined ||
      LARGE_BODY_OPEN_PATHS.includes(apiRoutePathOf(request.url));
    (large ? signedIn : signedOut)(request, response, next);
  };
}

/** The app's System health recorder; undefined in an app without `SystemHealthModule`. */
function systemHealthRecorderOf(app: INestApplication): SystemHealthRecorder | undefined {
  try {
    return app.get(SystemHealthRecorder, { strict: false });
  } catch {
    return undefined;
  }
}
