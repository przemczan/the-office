import { request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";
import { Controller, Get, Injectable, Module, Post, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Unsubscribe } from "../events/event-bus.js";
import { configureHttp, HTTP_APPLICATION_OPTIONS } from "./configure-http.js";
import { RequestAccessModule } from "./request-access.module.js";
import { SignedIn, SignedInRequests } from "./signed-in-requests.js";

const PUBLIC_ADDRESS = "https://office.example.com";
const SIGNED_IN: SignedIn = { userId: "user-1", signedInDeviceId: "device-1" };
/** The stand-in cookie a request signs in with. */
const SIGNED_IN_COOKIE = "signed-in=yes";

@Controller()
class ProbeController {
  @Get("probe")
  probe(@SignedIn() signedIn: SignedIn): { reached: true; signedIn: SignedIn } {
    return { reached: true, signedIn };
  }

  @Get("sign-in")
  signIn(): { reached: true } {
    return { reached: true };
  }

  @Post("sign-in/callback")
  callback(): { reached: true } {
    return { reached: true };
  }

  @Get("health")
  health(): { reached: true } {
    return { reached: true };
  }

  @Post("engine/claude-code-p/hook")
  hook(): { reached: true } {
    return { reached: true };
  }
}

/** Signs in a request carrying the stand-in cookie. */
@Injectable()
class CookieSignedIn extends SignedInRequests {
  signedInOf(request: IncomingMessage): Promise<SignedIn | undefined> {
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
  readonly body: unknown;
}

// node:http, since fetch does not let a test choose the Host header.
function send(method: "GET" | "POST", path: string, headers: OutgoingHttpHeaders): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port, method, path, headers }, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => (text += chunk));
      incoming.on("end", () =>
        resolve({ status: incoming.statusCode ?? 0, body: JSON.parse(text) }),
      );
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
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

    expect(reply).toEqual({ status: 200, body: { reached: true, signedIn: SIGNED_IN } });
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

    expect(reply).toEqual({
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

describe("the sign-in guard", () => {
  it.each(["/api/probe", "/API/PROBE", "/api/sign-in/../probe", "/api/no-such-route"])(
    "answers %s with 401 without a signed-in device, from localhost too",
    async (path) => {
      const reply = await get(path, { host: `localhost:${port}` });

      expect(reply).toEqual({
        status: 401,
        body: { statusCode: 401, message: "Sign in to The Office first.", error: "Unauthorized" },
      });
    },
  );

  it.each([
    ["GET", "/api/sign-in"],
    ["POST", "/api/sign-in/callback"],
    ["GET", "/api/health"],
    ["POST", "/api/engine/claude-code-p/hook"],
  ] as const)("leaves %s %s open", async (method, path) => {
    const reply = await send(method, path, { host: `localhost:${port}` });

    expect(reply.status).toBeLessThan(300);
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
