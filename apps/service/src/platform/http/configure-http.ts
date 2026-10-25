import type { INestApplication } from "@nestjs/common";

/** HTTP settings shared by the running service and the tests that serve it. */
export function configureHttp(app: INestApplication): void {
  app.setGlobalPrefix("api");
}
