import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { RequestAccessModule } from "../../platform/http/request-access.module.js";
import { Schedule } from "../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../platform/schedule/schedule.fixtures.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import {
  startTestApplication,
  type TestApplication,
  type TestApplicationOptions,
} from "../../../test/test-application.js";
import { testDatabaseUrl } from "../../../test/test-database.js";
import { quickPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.fixtures.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { PasswordHashing } from "./ports/password-hashing.js";
import { UsersModule, type UsersModuleOptions } from "./users.module.js";

export const PUBLIC_ADDRESS = "https://office.example.com";

export interface UsersApplication extends TestApplication {
  readonly schedule: ManualSchedule;
}

export interface UsersApplicationOptions {
  /** The database it runs on: the run's shared one unless the test brings its own. */
  readonly databaseUrl?: string;
  /** The identity providers bound, none unless the test brings some, such as `FakeIdentityProvider`. */
  readonly identityProviders?: UsersModuleOptions;
  /**
   * Replaces these providers wherever they are bound, such as `SecondSteps`. `PasswordHashing` is
   * always the quick one, `quickPasswordHashing`.
   */
  readonly overrides?: TestApplicationOptions["overrides"];
}

/**
 * The users module served as The Office serves it, guarded by its own signed-in devices, with the
 * event stream and the public address `PUBLIC_ADDRESS`.
 */
export async function startUsersApplication({
  databaseUrl = testDatabaseUrl(),
  identityProviders = { imports: [], identityProviders: [] },
  overrides = [],
}: UsersApplicationOptions = {}): Promise<UsersApplication> {
  const users = UsersModule.register(identityProviders);
  const started = await startTestApplication({
    imports: [
      DatabaseModule.forRoot({ url: databaseUrl }),
      EventsModule,
      EventStreamModule,
      users,
      RequestAccessModule.register({
        publicAddress: PUBLIC_ADDRESS,
        imports: [users],
        signedInRequests: CookieSignedInRequests,
      }),
    ],
    overrides: [{ provide: PasswordHashing, useValue: quickPasswordHashing }, ...overrides],
    requestAccess: "guarded",
  });
  return { ...started, schedule: started.app.get(Schedule) as ManualSchedule };
}

export interface Sent {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
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
            // A redirect's body is Express's words for it, not JSON.
            body: incoming.headers["content-type"]?.includes("json") ? JSON.parse(text) : undefined,
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
