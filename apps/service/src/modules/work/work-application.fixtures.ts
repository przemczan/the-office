import type { INestApplication } from "@nestjs/common";
import { workWebEventSchema } from "@the-office/contracts";
import { startTestApplication } from "../../../test/test-application.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { OfficeDataModule } from "../../platform/office-data/office-data.module.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../platform/websocket/web-event-forwarding.js";
import {
  KnownProjectsForTests,
  KnownProjectsForTestsModule,
} from "./ports/known-projects.fixtures.js";
import { WorkModule } from "./work.module.js";

/** The Work module served over HTTP on the test database, with every event it publishes. */
export interface WorkApplication {
  readonly app: INestApplication;
  readonly url: string;
  /** The events published since the application started or `published.length = 0`. */
  readonly published: DomainEvent[];
}

/** Every Project is known but UNKNOWN_PROJECT; files go into `officeDataFolder`. */
export async function startWorkApplication(officeDataFolder: string): Promise<WorkApplication> {
  const { app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      OfficeDataModule.forRoot(officeDataFolder),
      WorkModule.register({
        imports: [KnownProjectsForTestsModule],
        knownProjects: KnownProjectsForTests,
      }),
    ],
  });
  const published: DomainEvent[] = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  return { app, url, published };
}

/** The events published, as the web receives them, without their times. */
export function webEventsOf({ app, published }: WorkApplication): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = workWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

/** A JSON request to the application's API. */
export function sendJson(
  { url }: WorkApplication,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  return fetch(`${url}/api${path}`, init);
}
