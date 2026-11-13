import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  configureHttp,
  HTTP_APPLICATION_OPTIONS,
} from "../../../../platform/http/configure-http.js";
import { everyoneSignedIn } from "../../../../platform/http/signed-in-requests.fixtures.js";
import { SessionEndpoints } from "../claude-code-p/session-endpoints.js";
import { SessionEndpointsController } from "./session-endpoints.controller.js";

export interface ServedEndpoints {
  readonly app: INestApplication;
  readonly endpoints: SessionEndpoints;
  readonly port: number;
}

/**
 * The fallback's session endpoints served as the service serves them, on `localhost` behind its
 * HTTP settings, with no database: for tests of the endpoints and of the adapter on a live engine.
 */
export async function serveSessionEndpoints(): Promise<ServedEndpoints> {
  const moduleRef = await Test.createTestingModule({
    imports: [everyoneSignedIn()],
    controllers: [SessionEndpointsController],
    providers: [SessionEndpoints],
  }).compile();
  const app = moduleRef.createNestApplication({ ...HTTP_APPLICATION_OPTIONS, logger: false });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  return {
    app,
    endpoints: app.get(SessionEndpoints),
    port: Number(new URL(await app.getUrl()).port),
  };
}
