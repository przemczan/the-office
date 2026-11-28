import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";
import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  type INestApplication,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Unsubscribe } from "../events/event-bus.js";
import { configureHttp, HTTP_APPLICATION_OPTIONS } from "./configure-http.js";
import { RequestAccessModule } from "./request-access.module.js";
import { OpenWithoutSignIn } from "./sign-in-guard.js";
import { SignedIn, SignedInRequests } from "./signed-in-requests.js";

const PUBLIC_ADDRESS = "https://office.example.com";
const SIGNED_IN: SignedIn = { userId: "user-1", name: "Ann Lee", signedInDeviceId: "device-1" };
/** The stand-in cookie a request signs in with. */
const SIGNED_IN_COOKIE = "signed-in=yes";
/** A cookie whose check fails, as one does with the database down. */
const UNCHECKABLE_COOKIE = "signed-in=unknown";

@Controller()
class ProbeController {
  @Get("probe")
  probe(@SignedIn() signedIn: SignedIn): { reached: true; signedIn: SignedIn } {
    return { reached: true, signedIn };
  }

  @Post("probe")
  posted(@Body() body: unknown): { length: number } {
    return { length: JSON.stringify(body ?? {}).length };
  }

  @Post("users/:userId/one-time-password")
  oneTimePassword(@SignedIn() signedIn: SignedIn): { reached: true; signedIn: SignedIn } {
    return { reached: true, signedIn };
  }

  @Get("sign-in")
  @OpenWithoutSignIn()
  signIn(): { reached: true } {
    return { reached: true };
  }

  @Post("sign-in/callback")
  @OpenWithoutSignIn()
  callback(@Body() body: unknown): { length: number } {
    return { length: JSON.stringify(body ?? {}).length };
  }

  /** Under `/sign-in`, yet not marked open: the path alone opens nothing. */
  @Get("sign-in/unmarked")
  unmarked(): { reached: true } {
    return { reached: true };
  }

  @Get("health")
  @OpenWithoutSignIn()
  health(): { reached: true } {
    return { reached: true };
  }

  @Post("engine/claude-code-p/hook")
  @OpenWithoutSignIn()
  hook(@Body() body: unknown): { length: number } {
    return { length: JSON.stringify(body ?? {}).length };
  }
}

/** Signs in a request carrying the stand-in cookie. */
@Injectable()
class CookieSignedIn extends SignedInRequests {
  signedInOf(request: IncomingMessage): Promise<SignedIn | undefined> {
    if (request.headers.cookie === UNCHECKABLE_COOKIE) {
      return Promise.reject(new Error("The database is down."));
    }
    return Promise.resolve(request.headers.cookie === SIGNED_IN_COOKIE ? SIGNED_IN : undefined);
  }

  onSignedOut(): Unsubscribe {
    return () => undefined;
  }

  signedOutAmong(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

@Module({ providers: [CookieSignedIn], exports: [CookieSignedIn] })
class CookieSignedInModule {}

let app: INestApplication;
let port: number;

async function serve(): Promise<{ app: INestApplication; port: number }> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      RequestAccessModule.register({
        publicAddress: PUBLIC_ADDRESS,
        imports: [CookieSignedInModule],
        signedInRequests: CookieSignedIn,
      }),
    ],
    controllers: [ProbeController],
  }).compile();
  const served = moduleRef.createNestApplication({ ...HTTP_APPLICATION_OPTIONS, logger: false });
  configureHttp(served);
  await served.listen(0, "127.0.0.1");
  return { app: served, port: Number(new URL(await served.getUrl()).port) };
}

beforeAll(async () => {
  ({ app, port } = await serve());
});

afterAll(async () => {
  await app.close();
});

interface Reply {
  readonly status: number;
  readonly headers: IncomingMessage["headers"];
  readonly body: unknown;
}

// node:http, since fetch does not let a test choose the Host header, nor send a raw path.
function send(
  method: "GET" | "POST",
  path: string,
  headers: OutgoingHttpHeaders,
  body?: unknown,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: body === undefined ? headers : { ...headers, "content-type": "application/json" },
      },
      (incoming) => {
        let text = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => (text += chunk));
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: jsonOr(text),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

/** An answer's JSON, or its text, as Express's own error pages are. */
function jsonOr(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function get(path: string, headers: OutgoingHttpHeaders): Promise<Reply> {
  return send("GET", path, headers);
}

describe("configureHttp", () => {
  it("serves the API under /api to The Office's own page, to a signed-in device", async () => {
    const reply = await get("/api/probe", {
      host: `localhost:${port}`,
      origin: `http://localhost:${port}`,
      cookie: SIGNED_IN_COOKIE,
    });

    expect(reply).toMatchObject({ status: 200, body: { reached: true, signedIn: SIGNED_IN } });
  });

  it("serves its public address to its own https:// page", async () => {
    const reply = await get("/api/probe", {
      host: "office.example.com",
      origin: PUBLIC_ADDRESS,
      "x-forwarded-proto": "https",
      cookie: SIGNED_IN_COOKIE,
    });

    expect(reply.status).toBe(200);
  });

  it("refuses a request addressed to another name, before routing or signing in", async () => {
    const reply = await get("/api/no-such-route", {
      host: `evil.example:${port}`,
      cookie: SIGNED_IN_COOKIE,
    });

    expect(reply).toMatchObject({
      status: 403,
      body: {
        statusCode: 403,
        message:
          "The Office answers only requests addressed to localhost, its own IP address or its public address.",
        error: "Forbidden",
      },
    });
  });

  it("refuses a request from another site's page", async () => {
    const reply = await get("/api/probe", {
      host: `localhost:${port}`,
      origin: "https://evil.example",
      cookie: SIGNED_IN_COOKIE,
    });

    expect(reply.status).toBe(403);
  });
});

const SIGN_IN_FIRST_REPLY = {
  statusCode: 401,
  message: "Sign in to The Office first.",
  error: "Unauthorized",
};

describe("the sign-in guard", () => {
  it.each(["/api/probe", "/API/PROBE", "/api/sign-in/unmarked"])(
    "answers %s with 401 without a signed-in device, from localhost too",
    async (path) => {
      const reply = await get(path, { host: `localhost:${port}` });

      expect(reply).toMatchObject({ status: 401, body: SIGN_IN_FIRST_REPLY });
    },
  );

  it("answers a route that doesn't exist with 404, signed in or not", async () => {
    const signedOut = await get("/api/no-such-route", { host: `localhost:${port}` });
    const signedIn = await get("/api/no-such-route", {
      host: `localhost:${port}`,
      cookie: SIGNED_IN_COOKIE,
    });

    expect([signedOut.status, signedIn.status]).toEqual([404, 404]);
  });

  it.each([
    "/api/users/abc\\..\\..\\../one-time-password",
    "/api/sign-in\\..\\probe",
    "/api/sign-in/%2e%2e/probe",
    "/api/sign-in/%2E%2E/probe",
    "/api/sign-in%5c..%5cprobe",
    "/api/sign-in%5C..%5Cprobe",
    "/api/sign-in/../probe",
    "/api/sign-in/./callback",
    "/assets/../api/probe",
  ])("refuses the ambiguous path %s with 400, before routing or signing in", async (path) => {
    const reply = await send("POST", path, { host: `localhost:${port}`, cookie: SIGNED_IN_COOKIE });

    expect(reply).toMatchObject({
      status: 400,
      body: {
        statusCode: 400,
        message: "The Office doesn't answer this address.",
        error: "Bad Request",
      },
    });
  });

  it("reads a dot or a backslash in the query as any other character", async () => {
    const reply = await get("/api/probe?path=..%5Cnotes%2Etxt&raw=a\\b", {
      host: `localhost:${port}`,
      cookie: SIGNED_IN_COOKIE,
    });

    expect(reply.status).toBe(200);
  });

  it.each([
    ["GET", "/api/sign-in"],
    ["POST", "/api/sign-in/callback"],
    ["GET", "/api/health"],
    ["POST", "/api/engine/claude-code-p/hook"],
  ] as const)("leaves %s %s open", async (method, path) => {
    const reply = await send(method, path, { host: `localhost:${port}` });

    expect(reply.status).toBeLessThan(300);
  });

  it("answers 503 when who signed in can't be checked, and leaves the open routes answering", async () => {
    const guarded = await get("/api/probe", {
      host: `localhost:${port}`,
      cookie: UNCHECKABLE_COOKIE,
    });
    const health = await get("/api/health", {
      host: `localhost:${port}`,
      cookie: UNCHECKABLE_COOKIE,
    });

    expect(guarded).toMatchObject({
      status: 503,
      body: { statusCode: 503, message: "The Office could not check who is signed in." },
    });
    expect(health.status).toBe(200);
  });
});

describe("the JSON body", () => {
  const LARGE = { text: "x".repeat(200 * 1024) };

  it("is read up to 16 MB from a signed-in device", async () => {
    const reply = await send(
      "POST",
      "/api/probe",
      { host: `localhost:${port}`, cookie: SIGNED_IN_COOKIE },
      LARGE,
    );

    expect(reply.status).toBe(201);
  });

  it("is kept small on a route open without sign-in, but for the -p hook's", async () => {
    const callback = await send(
      "POST",
      "/api/sign-in/callback",
      { host: `localhost:${port}` },
      LARGE,
    );
    const hook = await send(
      "POST",
      "/api/engine/claude-code-p/hook",
      { host: `localhost:${port}` },
      LARGE,
    );

    expect(callback.status).toBe(413);
    expect(hook.status).toBe(201);
  });

  it("is never read whole for a guarded route without a signed-in device", async () => {
    const reply = await send("POST", "/api/probe", { host: `localhost:${port}` }, LARGE);

    expect(reply.status).toBe(413);
  });
});

describe("the security headers", () => {
  it("are on every answer: no sniffing, no referrer to other sites, no framing", async () => {
    const replies = await Promise.all([
      get("/api/probe", { host: `localhost:${port}`, cookie: SIGNED_IN_COOKIE }),
      get("/api/probe", { host: `localhost:${port}` }),
      get("/api/no-such-route", { host: `evil.example:${port}` }),
    ]);

    for (const { headers } of replies) {
      expect(headers).toMatchObject({
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
        "content-security-policy": "frame-ancestors 'none'",
      });
    }
  });
});

/** A connection as a browser leaves one: opened, with `sent` written and nothing after. */
function leftOpen(to: number, sent: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(to, "127.0.0.1", () => {
      socket.write(sent);
      resolve(socket);
    });
    socket.on("error", reject);
  });
}

describe("closing the service", () => {
  it("ends connections that never finished a request, rather than waiting on them", async () => {
    const closing = await serve();
    // A browser keeps a spare connection that never sends a request; another stopped mid-request.
    const spare = await leftOpen(closing.port, "");
    const halfSent = await leftOpen(closing.port, "GET /api/probe HTTP/1.1\r\nHost: localhost");
    const ended = Promise.all([spare, halfSent].map((socket) => onceClosed(socket)));

    const started = Date.now();
    await closing.app.close();
    await ended;

    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

function onceClosed(socket: Socket): Promise<void> {
  return new Promise((resolve) => socket.once("close", () => resolve()));
}
