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
import { ScryptPasswordHashing } from "./adapters/crypto/scrypt-password-hashing.js";
import { CookieSignedInRequests } from "./adapters/http/cookie-signed-in-requests.js";
import { PasswordHashing } from "./ports/password-hashing.js";
import { UsersModule } from "./users.module.js";

export const PUBLIC_ADDRESS = "https://office.example.com";

/**
 * scrypt at a cost tests can afford: the spec's takes about 100 ms a hash, so a lockout test's
 * dozen tries outran the test timeout under a full run's load. Hashes carry their own cost, so
 * either matches the other's.
 */
export const testPasswordHashing = new ScryptPasswordHashing(2 ** 10);

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
    overrides: [{ provide: PasswordHashing, useValue: testPasswordHashing }],
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
          // Node sends a DELETE's body only with its length given, as browsers give it.
          ...(payload !== undefined && {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(payload)),
          }),
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

/**
 * A cookie an answer set, as a Cookie header sends it back, and its attributes: the one named, or
 * the first.
 */
export function setCookieOf(
  answer: Answer,
  name?: string,
): {
  readonly cookie: string;
  readonly attributes: string[];
} {
  const setCookies = answer.headers["set-cookie"] ?? [];
  const setCookie =
    name === undefined ? setCookies[0] : setCookies.find((set) => set.startsWith(`${name}=`));
  if (setCookie === undefined) throw new Error(`The answer set no cookie ${name ?? ""}.`);
  const [cookie = "", ...attributes] = setCookie.split(";").map((part) => part.trim());
  return { cookie, attributes };
}
