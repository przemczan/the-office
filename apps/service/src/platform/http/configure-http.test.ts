import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureHttp, HTTP_APPLICATION_OPTIONS } from "./configure-http.js";

@Controller("probe")
class ProbeController {
  @Get()
  probe(): { reached: true } {
    return { reached: true };
  }
}

let app: INestApplication;
let port: number;

async function serve(): Promise<{ app: INestApplication; port: number }> {
  const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
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
function get(path: string, headers: OutgoingHttpHeaders): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port, path, headers }, (incoming) => {
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

describe("configureHttp", () => {
  it("serves the API under /api to The Office's own page", async () => {
    const reply = await get("/api/probe", {
      host: `localhost:${port}`,
      origin: `http://localhost:${port}`,
    });

    expect(reply).toEqual({ status: 200, body: { reached: true } });
  });

  it("refuses a request addressed to another name, before routing", async () => {
    const reply = await get("/api/no-such-route", { host: `evil.example:${port}` });

    expect(reply).toEqual({
      status: 403,
      body: {
        statusCode: 403,
        message:
          "The Office answers only requests addressed to localhost or to its own IP address.",
        error: "Forbidden",
      },
    });
  });

  it("refuses a request from another site's page", async () => {
    const reply = await get("/api/probe", {
      host: `localhost:${port}`,
      origin: "https://evil.example",
    });

    expect(reply.status).toBe(403);
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
