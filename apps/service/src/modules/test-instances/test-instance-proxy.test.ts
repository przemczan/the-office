import { rm } from "node:fs/promises";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { OfficeAddresses } from "../../platform/http/office-addresses.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../run-environments/index.fixtures.js";
import { NodeHttpProxyListeners } from "./adapters/proxy/node-http-proxy-listeners.js";
import { appCookiePrefix, instanceCookieName } from "./adapters/proxy/proxy-cookies.js";
import { HAND_OFF_MS, TestInstanceHandOffs } from "./application/test-instance-hand-offs.js";
import { OfficePort } from "./application/test-instance-limits.js";
import { OfficeHost, TestInstanceProxy } from "./application/test-instance-proxy.js";
import { DEFAULT_SETTINGS } from "./domain/test-instance-settings.js";
import type { TestInstance } from "./domain/test-instance.js";
import {
  ANN,
  TESTBED_OFFICE_PORT,
  testInstancesTestbed,
  WEB_TARGET,
  type TestInstancesTestbed,
} from "./test-instances.fixtures.js";

interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let runtime: ScriptedContainerRuntime;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;
let handOffs: TestInstanceHandOffs;
let listeners: NodeHttpProxyListeners;
let proxy: TestInstanceProxy;
let app: Server;
let appSockets: WebSocketServer;
/** Each request the app got, as it got it. */
let seen: { url: string; headers: IncomingHttpHeaders }[];
let firstPort: number;

/** The app a test instance runs: a tiny `node:http` server on a free loopback port. */
async function startApp(): Promise<number> {
  seen = [];
  app = createServer((incoming, response) => {
    seen.push({ url: incoming.url ?? "", headers: incoming.headers });
    if (incoming.url === "/set-cookie") {
      response.setHeader("set-cookie", [
        "office_signed_in=from-the-app; Domain=localhost; Path=/; HttpOnly",
        "theme=dark",
      ]);
    }
    if (incoming.url === "/away") {
      response.writeHead(302, { location: `http://localhost:${WEB_TARGET.port}/elsewhere` });
      response.end();
      return;
    }
    response.end("the app");
  });
  appSockets = new WebSocketServer({ server: app });
  appSockets.on("connection", (socket, upgrade) => {
    seen.push({ url: upgrade.url ?? "", headers: upgrade.headers });
    socket.on("message", (data) => socket.send(`echo ${String(data)}`));
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const address = app.address();
  if (address === null || typeof address === "string") throw new Error("The app has no port.");
  return address.port;
}

/** Three Proxy ports in a row that nothing listens on. */
async function freePortsInARow(count: number): Promise<number> {
  for (;;) {
    const first = 21_000 + Math.floor(Math.random() * 9_000);
    const ports = Array.from({ length: count }, (_, index) => first + index);
    if ((await Promise.all(ports.map(isFree))).every(Boolean)) return first;
  }
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  runtime.keepExecsRunning();
  runtime.hostPort = await startApp();
  environments = await runEnvironmentsTestbed(runtime, undefined, undefined, {
    timeoutMs: 100,
    intervalMs: 5,
    answers: (port) => runtime.answers(port),
  });
  testbed = testInstancesTestbed(
    environments.hostedServices,
    join(environments.folder, "office-data"),
  );
  firstPort = await freePortsInARow(3);
  testbed.settings.settings = {
    ...DEFAULT_SETTINGS,
    firstProxyPort: firstPort,
    lastProxyPort: firstPort + 2,
  };
  handOffs = new TestInstanceHandOffs(
    testbed.running,
    testbed.instances,
    testbed.schedule,
    testbed.events,
  );
  handOffs.onModuleInit();
  listeners = new NodeHttpProxyListeners(
    testbed.running,
    handOffs,
    new OfficeHost("127.0.0.1"),
    new OfficePort(TESTBED_OFFICE_PORT),
    new OfficeAddresses(undefined),
  );
  proxy = new TestInstanceProxy(listeners, testbed.running, testbed.events);
  await proxy.start();
});

afterEach(async () => {
  for (const instance of await testbed.repository.active()) {
    await testbed.instances.stop(instance.id);
  }
  await testbed.instances.settled();
  await proxy.onModuleDestroy();
  handOffs.onModuleDestroy();
  for (const socket of appSockets.clients) socket.terminate();
  appSockets.close();
  app.closeAllConnections();
  await new Promise((resolve) => app.close(resolve));
  await rm(environments.folder, { recursive: true, force: true });
});

/** A request to a Proxy port, addressed to `127.0.0.1:<port>` unless the headers say otherwise. */
function call(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        agent: false,
        headers: { host: `127.0.0.1:${port}`, ...headers },
      },
      (answer) => {
        let body = "";
        answer.setEncoding("utf8");
        answer.on("data", (chunk: string) => (body += chunk));
        answer.on("end", () =>
          resolve({ status: answer.statusCode ?? 0, headers: answer.headers, body }),
        );
      },
    );
    sent.on("error", reject);
    sent.end();
  });
}

/** Signs a browser in to the instance through a hand-off link; answers its Cookie pair. */
async function signIn(instance: TestInstance): Promise<string> {
  const { token } = await handOffs.open(instance.id);
  const answer = await call(portOf(instance), `/__office/hand-off?t=${token}`);
  expect(answer.status).toBe(200);
  const cookie = answer.headers["set-cookie"]?.[0] ?? "";
  return cookie.split(";")[0] ?? "";
}

function portOf(instance: TestInstance): number {
  if (instance.port === undefined) throw new Error("The instance has no port.");
  return instance.port;
}

function launch(): Promise<TestInstance> {
  return testbed.instances.launchOnInitiative(
    testbed.initiativeId,
    { projectId: "shop", targetKey: "web" },
    ANN,
  );
}

describe("the test-instance proxy (DoD 7)", () => {
  it("refuses a port with no Running instance with its page", async () => {
    const release: (() => void)[] = [];
    const held = new Promise<void>((resolve) => release.push(resolve));
    const checkOut = testbed.projects.checkOut.bind(testbed.projects);
    vi.spyOn(testbed.projects, "checkOut").mockImplementationOnce(async (...args) => {
      await held;
      return checkOut(...args);
    });
    const building = await launch();
    expect(listeners.listening()).toContain(portOf(building));

    const answer = await call(portOf(building), "/");

    expect(answer.status).toBe(503);
    expect(answer.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(answer.body).toContain("No test instance is running at this port");
    expect(seen).toEqual([]);
    for (const each of release) each();
  });

  it("answers a plain 421 to a Host other than the port's own addresses", async () => {
    const instance = await testbed.launchAndSettle();
    const cookie = await signIn(instance);

    const answer = await call(portOf(instance), "/", {
      host: `rebound.example.com:${portOf(instance)}`,
      cookie,
    });

    expect(answer.status).toBe(421);
    expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(answer.body).toBe("Misdirected Request\n");
    expect(seen).toEqual([]);
    expect(
      (await call(portOf(instance), "/", { host: `localhost:${portOf(instance)}`, cookie })).status,
    ).toBe(200);
  });

  it("refuses a request without the instance's cookie with the page saying to open it from The Office", async () => {
    const instance = await testbed.launchAndSettle();

    const answer = await call(portOf(instance), "/settings", { cookie: "office_signed_in=real" });

    expect(answer.status).toBe(401);
    expect(answer.body).toContain("Open this test instance from The Office");
    expect(answer.body).toContain(`href="http://127.0.0.1:${TESTBED_OFFICE_PORT}/"`);
    expect(seen).toEqual([]);
  });

  it("refuses a request carrying another instance's cookie", async () => {
    const first = await testbed.launchAndSettle();
    const second = await testbed.launchAndSettle();
    const firstCookie = await signIn(first);
    const [, value] = firstCookie.split("=");

    const otherCookie = await call(portOf(second), "/", { cookie: firstCookie });
    const otherValue = await call(portOf(second), "/", {
      cookie: `${instanceCookieName(second.id)}=${value ?? ""}`,
    });

    expect(otherCookie.status).toBe(401);
    expect(otherValue.status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("strips The Office's sign-in cookie and the instances' own before the app sees the request", async () => {
    const instance = await testbed.launchAndSettle();
    const cookie = await signIn(instance);

    const answer = await call(portOf(instance), "/page", {
      cookie: `office_signed_in=the-office-token; ${cookie}; office_test_instance_other=x`,
    });

    expect(answer).toMatchObject({ status: 200, body: "the app" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("/page");
    expect(seen[0]?.headers.cookie).toBeUndefined();
  });

  it("rewrites Host and Origin to the instance's own address", async () => {
    const instance = await testbed.launchAndSettle();
    const cookie = await signIn(instance);

    await call(portOf(instance), "/", { cookie, origin: `http://127.0.0.1:${portOf(instance)}` });
    await call(portOf(instance), "/no-origin", { cookie });
    const redirect = await call(portOf(instance), "/away", { cookie });

    expect(seen[0]?.headers.host).toBe(`localhost:${WEB_TARGET.port}`);
    expect(seen[0]?.headers.origin).toBe(`http://localhost:${WEB_TARGET.port}`);
    expect(seen[1]?.headers.origin).toBeUndefined();
    expect(redirect.headers.location).toBe(`http://127.0.0.1:${portOf(instance)}/elsewhere`);
  });

  it("namespaces the app's cookies, so its office_signed_in never reaches the browser by that name", async () => {
    const instance = await testbed.launchAndSettle();
    const cookie = await signIn(instance);
    const prefix = appCookiePrefix(instance.id);

    const answer = await call(portOf(instance), "/set-cookie", { cookie });
    await call(portOf(instance), "/", {
      cookie: `office_signed_in=the-office-token; ${cookie}; ${prefix}office_signed_in=from-the-app; ${prefix}theme=dark`,
    });

    expect(prefix).toBe(`oti_${instance.id.replaceAll("-", "").slice(0, 8)}_`);
    expect(answer.headers["set-cookie"]).toEqual([
      `${prefix}office_signed_in=from-the-app; Path=/; HttpOnly`,
      `${prefix}theme=dark`,
    ]);
    expect(seen[1]?.headers.cookie).toBe("office_signed_in=from-the-app; theme=dark");
  });

  it("counts each forwarded request as the instance's activity, holding off its Idle time stop", async () => {
    const instance = await testbed.launchAndSettle();
    const cookie = await signIn(instance);

    await testbed.schedule.advanceBy(20 * 60_000);
    expect((await call(portOf(instance), "/", { cookie })).status).toBe(200);
    await testbed.schedule.advanceBy(20 * 60_000);
    expect((await testbed.instances.read(instance.id)).state).toBe("running");

    await testbed.schedule.advanceBy(11 * 60_000);

    expect((await testbed.instances.read(instance.id)).state).toBe("stopped");
  });

  it("forwards a WebSocket upgrade with the same checks", async () => {
    const instance = await testbed.launchAndSettle();
    const cookie = await signIn(instance);
    const address = `ws://127.0.0.1:${portOf(instance)}/socket`;

    const refused = await new Promise<number>((resolve, reject) => {
      const socket = new WebSocket(address);
      socket.on("unexpected-response", (_, answer) => resolve(answer.statusCode ?? 0));
      socket.on("open", () => reject(new Error("The upgrade without the cookie went through.")));
    });
    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(address, {
        headers: { cookie: `office_signed_in=the-office-token; ${cookie}` },
        origin: `http://127.0.0.1:${portOf(instance)}`,
      });
      socket.on("open", () => socket.send("hello"));
      socket.on("message", (data) => {
        resolve(String(data));
        socket.close();
      });
      socket.on("error", reject);
    });

    expect(refused).toBe(401);
    expect(echoed).toBe("echo hello");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("/socket");
    expect(seen[0]?.headers.host).toBe(`localhost:${WEB_TARGET.port}`);
    expect(seen[0]?.headers.origin).toBe(`http://localhost:${WEB_TARGET.port}`);
    expect(seen[0]?.headers.cookie).toBeUndefined();
  });
});

describe("the hand-off link (DoD 8)", () => {
  it("is refused when used twice", async () => {
    const instance = await testbed.launchAndSettle();
    const { token } = await handOffs.open(instance.id);

    const first = await call(portOf(instance), `/__office/hand-off?t=${token}`);
    const second = await call(portOf(instance), `/__office/hand-off?t=${token}`);

    expect(first.status).toBe(200);
    expect(first.headers.location).toBeUndefined();
    expect(first.headers["referrer-policy"]).toBe("no-referrer");
    expect(first.body).toContain('<meta http-equiv="refresh" content="0; url=/">');
    expect(second.status).toBe(403);
    expect(second.body).toContain("This link has been used or has expired");
  });

  it("is refused after about 60 seconds", async () => {
    const instance = await testbed.launchAndSettle();
    const { token } = await handOffs.open(instance.id);

    await testbed.schedule.advanceBy(HAND_OFF_MS + 1_000);
    const answer = await call(portOf(instance), `/__office/hand-off?t=${token}`);

    expect(answer.status).toBe(403);
    expect(answer.headers["set-cookie"]).toBeUndefined();
  });

  it("is refused at another instance's port", async () => {
    const first = await testbed.launchAndSettle();
    const second = await testbed.launchAndSettle();
    const { token } = await handOffs.open(first.id);

    const answer = await call(portOf(second), `/__office/hand-off?t=${token}`);

    expect(answer.status).toBe(403);
    expect(answer.headers["set-cookie"]).toBeUndefined();
  });

  it("sets a cookie of that instance alone, HttpOnly and SameSite=Strict", async () => {
    const instance = await testbed.launchAndSettle();
    const { token } = await handOffs.open(instance.id);

    const answer = await call(portOf(instance), `/__office/hand-off?t=${token}`);

    const [setCookie] = answer.headers["set-cookie"] ?? [];
    expect(setCookie).toMatch(
      new RegExp(
        `^office_test_instance_${instance.id}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=/$`,
      ),
    );
    expect(seen).toEqual([]);
  });

  it("gives a cookie that stops working once the instance stops, its port closed", async () => {
    const instance = await testbed.launchAndSettle();
    const cookie = await signIn(instance);
    const [, value] = cookie.split("=");
    expect((await call(portOf(instance), "/", { cookie })).status).toBe(200);

    await testbed.instances.stop(instance.id);

    expect(handOffs.admits(instance.id, value)).toBe(false);
    expect(listeners.listening()).not.toContain(portOf(instance));
    await expect(call(portOf(instance), "/", { cookie })).rejects.toThrow(/ECONNREFUSED/);
  });
});
