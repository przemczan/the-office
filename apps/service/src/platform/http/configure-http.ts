import type { INestApplication, NestApplicationOptions } from "@nestjs/common";
import { API_PATH } from "@the-office/contracts";
import { refuseNonLocalRequests } from "./local-requests.js";

/**
 * How the service's Nest application is created, by the running service and the tests that serve
 * it. Closing ends every connection still open: Node's own close waits for each to finish a
 * request, and a browser keeps spare connections that never send one, so a page left open could
 * hold the shutdown forever (as could a WebSocket client that never answers the close).
 */
export const HTTP_APPLICATION_OPTIONS = {
  forceCloseConnections: true,
} as const satisfies NestApplicationOptions;

/** HTTP settings shared by the running service and the tests that serve it. */
export function configureHttp(app: INestApplication): void {
  app.use(refuseNonLocalRequests);
  app.setGlobalPrefix(API_PATH);
}
