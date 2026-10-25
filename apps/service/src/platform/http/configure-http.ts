import type { INestApplication } from "@nestjs/common";
import { refuseNonLocalRequests } from "./local-requests.js";

/** HTTP settings shared by the running service and the tests that serve it. */
export function configureHttp(app: INestApplication): void {
  app.use(refuseNonLocalRequests);
  app.setGlobalPrefix("api");
}
