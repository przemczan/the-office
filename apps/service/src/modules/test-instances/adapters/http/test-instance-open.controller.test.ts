import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { testInstanceOpeningSchema } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../../run-environments/index.fixtures.js";
import { TestInstanceHandOffs } from "../../application/test-instance-hand-offs.js";
import { testInstancesTestbed, type TestInstancesTestbed } from "../../test-instances.fixtures.js";
import { TestInstanceOpenController } from "./test-instance-open.controller.js";

let app: INestApplication;
let url: string;
let port: number;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;
let handOffs: TestInstanceHandOffs;

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
    providers: [{ provide: TestInstanceHandOffs, useValue: handOffs }],
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

/** POST /api/test-instances/:id/open, addressed to `host`. */
function open(id: string, host: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/api/test-instances/${id}/open`,
        headers: { host },
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
    sent.end();
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
