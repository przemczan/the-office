import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureHttp } from "./configure-http.js";

@Controller("probe")
class ProbeController {
  @Get()
  probe(): { reached: true } {
    return { reached: true };
  }
}

let app: INestApplication;
let port: number;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  port = Number(new URL(await app.getUrl()).port);
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
        message: "The Office answers only requests addressed to localhost or 127.0.0.1.",
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
