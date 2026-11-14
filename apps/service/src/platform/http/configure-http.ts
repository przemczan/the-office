import type { INestApplication, NestApplicationOptions } from "@nestjs/common";
import { API_PATH } from "@the-office/contracts";
import express from "express";
import { OfficeAddresses } from "./office-addresses.js";
import { refuseNonLocalRequests, refuseSignedOutRequests } from "./request-access.js";
import { SignedInRequests } from "./signed-in-requests.js";

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
 * The largest JSON body the service reads. An engine's hook call carries the tool call's input
 * whole, a Write's file among it, so the parser's 100 kB default would refuse large writes.
 */
const JSON_BODY_LIMIT = "16mb";

/**
 * HTTP settings shared by the running service and the tests that serve it, on the addresses and
 * signed-in devices `RequestAccessModule` binds: the Host and Origin checks, then the sign-in
 * guard, both before a body is read. Nest adds no JSON parser of its own once one is in place.
 */
export function configureHttp(app: INestApplication): void {
  app.use(refuseNonLocalRequests(app.get(OfficeAddresses)));
  app.use(refuseSignedOutRequests(app.get(SignedInRequests)));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.setGlobalPrefix(API_PATH);
}
