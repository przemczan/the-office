import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { testInstanceAddressesSchema, testInstanceOpeningSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../../run-environments/index.fixtures.js";
import { TestInstanceHandOffs } from "../../application/test-instance-hand-offs.js";
import { OfficeHost } from "../../application/test-instance-proxy.js";
import { WorkstationAddresses, type InterfaceAddress } from "../../ports/workstation-addresses.js";
import { testInstancesTestbed, type TestInstancesTestbed } from "../../test-instances.fixtures.js";
import { TestInstanceOpenController } from "./test-instance-open.controller.js";

let app: INestApplication;
let url: string;
let port: number;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;
let handOffs: TestInstanceHandOffs;

/** A workstation on a home network, with IPv6 too; The Office listens on every address. */
class HomeNetwork extends WorkstationAddresses {
  list(): readonly InterfaceAddress[] {
    return [
      { address: "127.0.0.1", family: "IPv4", internal: true },
      { address: "::1", family: "IPv6", internal: true },
      { address: "192.168.1.20", family: "IPv4", internal: false },
      { address: "fe80::1c2b:3aff:fe4d:5e6f", family: "IPv6", internal: false },
    ];
  }
}

beforeEach(async () => {
  const runtime = new ScriptedContainerRuntime();
  runtime.keepExecsRunning();
  environments = await runEnvironmentsTestbed(runtime, undefined, undefined, {
    timeoutMs: 100,
    intervalMs: 5,
    answers: (answering) => runtime.answers(answering),
  });
  testbed = testInstancesTestbed(
    environments.hostedServices,
    join(environments.folder, "office-data"),
  );
  handOffs = new TestInstanceHandOffs(
    testbed.running,
    testbed.instances,
    testbed.schedule,
    testbed.events,
  );
  handOffs.onModuleInit();
  ({ app, url, port } = await startTestApplication({
    controllers: [TestInstanceOpenController],
    providers: [
      { provide: TestInstanceHandOffs, useValue: handOffs },
      { provide: OfficeHost, useValue: new OfficeHost("0.0.0.0") },
      { provide: WorkstationAddresses, useClass: HomeNetwork },
    ],
  }));
});

afterEach(async () => {
  for (const instance of await testbed.repository.active()) {
    await testbed.instances.stop(instance.id);
  }
  await testbed.instances.settled();
  handOffs.onModuleDestroy();
  await app.close();
  await rm(environments.folder, { recursive: true, force: true });
});

/** POST /api/test-instances/:id/open, addressed to `host`, choosing `hostname` when given. */
function open(
  id: string,
  host: string,
  hostname?: string,
): Promise<{ status: number; body: unknown }> {
  return call(
    "POST",
    `/api/test-instances/${id}/open`,
    host,
    hostname === undefined ? undefined : { hostname },
  );
}

function call(
  method: string,
  path: string,
  host: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: { host, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        agent: false,
      },
      (answer) => {
        let text = "";
        answer.setEncoding("utf8");
        answer.on("data", (chunk: string) => (text += chunk));
        answer.on("end", () =>
          resolve({ status: answer.statusCode ?? 0, body: JSON.parse(text) as unknown }),
        );
      },
    );
    sent.on("error", reject);
    sent.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe("POST /test-instances/:id/open", () => {
  it("answers a hand-off link to the instance's Proxy port at the hostname The Office was reached at", async () => {
    const instance = await testbed.launchAndSettle();

    const response = await fetch(`${url}/api/test-instances/${instance.id}/open`, {
      method: "POST",
    });
    const atLocalhost = await open(instance.id, `localhost:${port}`);

    expect(response.status).toBe(200);
    const { url: link } = testInstanceOpeningSchema.parse(await response.json());
    const handOff = new URL(link);
    expect(`${handOff.origin}${handOff.pathname}`).toBe(
      `http://127.0.0.1:${instance.port}/__office/hand-off`,
    );
    expect(handOff.searchParams.get("t")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(handOffs.exchange(instance.id, handOff.searchParams.get("t") ?? "")).toBeDefined();
    expect(atLocalhost.status).toBe(200);
    expect(testInstanceOpeningSchema.parse(atLocalhost.body).url).toMatch(
      new RegExp(`^http://localhost:${instance.port}/__office/hand-off\\?t=`),
    );
  });

  it("answers a link at the address chosen among those offered, and refuses one not offered with 400", async () => {
    const instance = await testbed.launchAndSettle();

    const atLan = await open(instance.id, `localhost:${port}`, "192.168.1.20");
    const elsewhere = await open(instance.id, `localhost:${port}`, "rebound.example.com");

    expect(atLan.status).toBe(200);
    expect(testInstanceOpeningSchema.parse(atLan.body).url).toMatch(
      new RegExp(`^http://192\\.168\\.1\\.20:${instance.port}/__office/hand-off\\?t=`),
    );
    expect(elsewhere.status).toBe(400);
  });

  it("is refused with 409 unless the instance is Running, and 404 for none", async () => {
    const instance = await testbed.launchAndSettle();
    await testbed.instances.stop(instance.id);

    const stopped = await open(instance.id, `127.0.0.1:${port}`);
    const none = await open(randomUUID(), `127.0.0.1:${port}`);

    expect(stopped.status).toBe(409);
    expect(stopped.body).toMatchObject({ message: expect.stringContaining("isn't Running") });
    expect(none.status).toBe(404);
  });
});

describe("GET /test-instances/addresses", () => {
  it("offers the page's own address first, then localhost and each network address but a link-local one", async () => {
    const atLoopback = await call("GET", "/api/test-instances/addresses", `127.0.0.1:${port}`);
    const atLocalhost = await call("GET", "/api/test-instances/addresses", `localhost:${port}`);

    expect(testInstanceAddressesSchema.parse(atLoopback.body).hostnames).toEqual([
      "127.0.0.1",
      "localhost",
      "192.168.1.20",
    ]);
    expect(testInstanceAddressesSchema.parse(atLocalhost.body).hostnames).toEqual([
      "localhost",
      "192.168.1.20",
    ]);
  });
});
