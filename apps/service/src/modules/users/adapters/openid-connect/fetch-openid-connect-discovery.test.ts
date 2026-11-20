import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenIdConnectDiscoveryFailed } from "../../ports/openid-connect-discovery.js";
import { FetchOpenIdConnectDiscovery } from "./fetch-openid-connect-discovery.js";

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];
let requested: string[];

beforeEach(() => {
  requested = [];
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A provider on 127.0.0.1 at a free port; answers its address. */
async function providerAnswering(handler: Handler): Promise<string> {
  const server = createServer((request, response) => {
    requested.push(request.url ?? "");
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function json(body: unknown, status = 200): Handler {
  return (_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
}

describe("FetchOpenIdConnectDiscovery", () => {
  it("reads the issuer and the two endpoints from the document under the issuer", async () => {
    const issuer = await providerAnswering((request, response) =>
      json({
        issuer: `http://127.0.0.1:1`,
        authorization_endpoint: "https://login.example.com/authorize",
        token_endpoint: "https://login.example.com/token",
        userinfo_endpoint: "https://login.example.com/userinfo",
      })(request, response),
    );

    const found = await new FetchOpenIdConnectDiscovery().discover(issuer);

    expect(requested).toEqual(["/.well-known/openid-configuration"]);
    expect(found).toEqual({
      issuer: "http://127.0.0.1:1",
      authorizationEndpoint: "https://login.example.com/authorize",
      tokenEndpoint: "https://login.example.com/token",
    });
  });

  it("refuses an issuer answering HTTP 404, with the status", async () => {
    const issuer = await providerAnswering(json({ error: "not found" }, 404));

    await expect(new FetchOpenIdConnectDiscovery().discover(issuer)).rejects.toThrow(
      /answered HTTP 404/,
    );
  });

  it("refuses an answer that isn't JSON, or isn't a discovery document", async () => {
    const html = await providerAnswering((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html>Sign in</html>");
    });
    const missing = await providerAnswering(
      json({
        issuer: "https://login.example.com",
        authorization_endpoint: "https://login.example.com/a",
      }),
    );
    const notAddress = await providerAnswering(
      json({
        issuer: "https://login.example.com",
        authorization_endpoint: "nope",
        token_endpoint: "nope",
      }),
    );
    const discovery = new FetchOpenIdConnectDiscovery();

    for (const issuer of [html, missing, notAddress]) {
      await expect(discovery.discover(issuer)).rejects.toThrow(
        /isn't an OpenID Connect discovery document/,
      );
    }
  });

  it("refuses an issuer nothing answers at, as a failure and not a crash", async () => {
    const issuer = await providerAnswering(json({}));
    await new Promise<void>((resolve) => {
      const server = servers.pop();
      server?.close(() => resolve());
    });

    const failure = await new FetchOpenIdConnectDiscovery()
      .discover(issuer)
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(OpenIdConnectDiscoveryFailed);
    expect((failure as Error).message).toContain("couldn't reach");
  });

  it("gives up on an issuer that never answers, saying so", async () => {
    const issuer = await providerAnswering(() => undefined);

    await expect(new FetchOpenIdConnectDiscovery(200).discover(issuer)).rejects.toThrow(
      "didn't answer",
    );
  });
});
