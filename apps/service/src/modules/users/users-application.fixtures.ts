import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import type { ModuleMetadata } from "@nestjs/common";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { RequestAccessModule } from "../../platform/http/request-access.module.js";
import { Schedule } from "../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { startTestApplication, type TestApplication } from "../../../test/test-application.js";
import { testDatabaseUrl } from "../../../test/test-database.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { UsersModule } from "./users.module.js";

export const PUBLIC_ADDRESS = "https://office.example.com";

export interface UsersApplication extends TestApplication {
  readonly schedule: ManualSchedule;
}

export interface UsersApplicationOptions {
  /** The database it runs on: the run's shared one unless the test brings its own. */
  readonly databaseUrl?: string;
  /** More modules to boot with it, such as one adding a claim on earlier records. */
  readonly imports?: NonNullable<ModuleMetadata["imports"]>;
}

/**
 * The users module served as The Office serves it, guarded by its own signed-in devices, with the
 * event stream and the public address `PUBLIC_ADDRESS`.
 */
export async function startUsersApplication({
  databaseUrl = testDatabaseUrl(),
  imports = [],
}: UsersApplicationOptions = {}): Promise<UsersApplication> {
  const started = await startTestApplication({
    imports: [
      ...imports,
      DatabaseModule.forRoot({ url: databaseUrl }),
      EventsModule,
      EventStreamModule,
      UsersModule,
      RequestAccessModule.register({
        publicAddress: PUBLIC_ADDRESS,
        imports: [UsersModule],
        signedInRequests: CookieSignedInRequests,
      }),
    ],
    requestAccess: "guarded",
  });
  return { ...started, schedule: started.app.get(Schedule) as ManualSchedule };
}

export interface Sent {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly path: string;
  /** The Host the request is addressed to: `localhost` at the app's port unless given. */
  readonly host?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

/** A request to the app on 127.0.0.1, addressed as a browser at `host` would address it. */
export function send(
  port: number,
  { method = "GET", path, host = `localhost:${port}`, headers = {}, body }: Sent,
): Promise<Answer> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          host,
          ...(payload !== undefined && { "content-type": "application/json" }),
          ...headers,
        },
      },
      (incoming) => {
        let text = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (text += chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: text === "" ? undefined : JSON.parse(text),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(payload);
  });
}

/** The sign-in cookie an answer set, as a Cookie header sends it back, and its attributes. */
export function setCookieOf(answer: Answer): {
  readonly cookie: string;
  readonly attributes: string[];
} {
  const [setCookie] = answer.headers["set-cookie"] ?? [];
  if (setCookie === undefined) throw new Error("The answer set no cookie.");
  const [cookie = "", ...attributes] = setCookie.split(";").map((part) => part.trim());
  return { cookie, attributes };
}
