import { Global, Module, type INestApplication } from "@nestjs/common";
import { EVENTS_PATH } from "@the-office/contracts";
import { WebSocket as WsClient } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { EventBus } from "../events/event-bus.js";
import { EventsModule } from "../events/events.module.js";
import {
  ANOTHER_SIGNED_IN_FOR_TESTS,
  SIGNED_IN_FOR_TESTS,
  signedInAs,
} from "../http/signed-in-requests.fixtures.js";
import type { SignedIn } from "../http/signed-in-requests.js";
import { Schedule } from "../schedule/schedule.js";
import type { ManualSchedule } from "../schedule/schedule.fixtures.js";
import { WebAppBuild } from "../web-app/web-app-build.js";
import { EventStream, SIGNED_IN_CHECK_EVERY_MS, SIGNED_OUT } from "./event-stream.js";
import { EventStreamModule } from "./event-stream.module.js";
import { WebSocketRoutes } from "./websocket-routes.js";
import { WebEventForwarding } from "./web-event-forwarding.js";
import {
  devicesForTests,
  DevicesForTests,
  LampLit,
  LampLitFor,
  LampDimmed,
  messageSchema,
  type Message,
  changeSubscription,
  forwardThreadEvents,
  OutputPrinted,
  SubAgentWrote,
  THREAD_A,
  THREAD_B,
} from "./event-stream.fixtures.js";

let app: INestApplication;
let bus: EventBus;
let port: number;
const clients: WebSocket[] = [];
const wsClients: WsClient[] = [];

beforeEach(async () => {
  ({ app, port } = await startTestApplication({ imports: [EventsModule, EventStreamModule] }));
  bus = app.get(EventBus);
  const forwarding = app.get(WebEventForwarding);
  forwarding.forward(LampLit, (event) => ({ type: "lamp.lit", room: event.room }));
  forwarding.forward(LampDimmed, () => ({ type: "lamp.dimmed" }));
  forwarding.forwardToUser(
    LampLitFor,
    (event) => event.userId,
    (event) => ({ type: "lamp.lit", room: event.room }),
  );
  forwardThreadEvents(forwarding);
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const client of wsClients.splice(0)) client.close();
  await app.close();
});

/** A browser-like client: Node's own WebSocket, every frame parsed with the contract. */
async function connect(): Promise<{ client: WebSocket; next: () => Promise<Message> }> {
  const client = new WebSocket(`ws://localhost:${port}${EVENTS_PATH}`);
  clients.push(client);
  const received: Message[] = [];
  const waiting: ((message: Message) => void)[] = [];
  client.addEventListener("message", (frame) => {
    const message = messageSchema.parse(JSON.parse(String(frame.data)));
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else received.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    client.addEventListener("open", () => resolve(), { once: true });
    client.addEventListener("error", () => reject(new Error("the WebSocket did not open")), {
      once: true,
    });
  });
  const next = (): Promise<Message> => {
    const message = received.shift();
    return message ? Promise.resolve(message) : new Promise((resolve) => waiting.push(resolve));
  };
  return { client, next };
}

/** A client signed in as `user`, subscribed to `events`, every frame parsed with the contract. */
async function connectSignedInAs(
  user: SignedIn,
  events: string[],
): Promise<() => Promise<Message>> {
  const client = new WsClient(`ws://localhost:${port}${EVENTS_PATH}`, {
    headers: signedInAs(user),
  });
  const received: Message[] = [];
  const waiting: ((message: Message) => void)[] = [];
  client.on("message", (data: Buffer) => {
    const message = messageSchema.parse(JSON.parse(data.toString()));
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else received.push(message);
  });
  await new Promise((resolve) => client.once("open", resolve));
  wsClients.push(client);
  const next = (): Promise<Message> => {
    const message = received.shift();
    return message ? Promise.resolve(message) : new Promise((resolve) => waiting.push(resolve));
  };
  client.send(JSON.stringify({ type: "subscribe", events }));
  expect(await next()).toEqual({ type: "subscriptions", events });
  return next;
}

/** The room of the next lamp lit, or the message when it is another. */
async function room(next: () => Promise<Message>): Promise<unknown> {
  const message = await next();
  return message.type === "event" && "room" in message.event ? message.event.room : message;
}

describe("the event stream", () => {
  it("delivers a forwarded event of a subscribed type, typed by the contract", async () => {
    const { client, next } = await connect();

    expect(await changeSubscription(client, next, "subscribe", ["lamp.lit"])).toEqual({
      type: "subscriptions",
      events: ["lamp.lit"],
    });
    await bus.publish(new LampLit("hall"));

    expect(await next()).toEqual({
      type: "event",
      event: { type: "lamp.lit", occurredAt: "2026-10-25T09:00:00.000Z", room: "hall" },
    });
  });

  it("sends a Thread's output only to the pages subscribed to it for that Thread", async () => {
    const pageOfA = await connect();
    const unscoped = await connect();
    const streams = ["thread.process-output", "thread.sub-agent-messages"];
    expect(
      await changeSubscription(pageOfA.client, pageOfA.next, "subscribe", streams, THREAD_A),
    ).toEqual({ type: "subscriptions", events: streams.toSorted(), threadId: THREAD_A });
    await changeSubscription(unscoped.client, unscoped.next, "subscribe", [
      ...streams,
      "lamp.dimmed",
    ]);

    await bus.publish(new OutputPrinted(THREAD_B));
    await bus.publish(new SubAgentWrote(THREAD_B));
    await bus.publish(new OutputPrinted(THREAD_A));
    await bus.publish(new SubAgentWrote(THREAD_A));
    await bus.publish(new LampDimmed());

    // Frames arrive in order, so Thread A's coming first shows Thread B's were not sent.
    expect(await pageOfA.next()).toMatchObject({
      type: "event",
      event: { type: "thread.process-output", threadId: THREAD_A },
    });
    expect(await pageOfA.next()).toMatchObject({
      type: "event",
      event: { type: "thread.sub-agent-messages", threadId: THREAD_A },
    });
    // Subscribed without a Thread, the page gets no Thread's output, and other types as before.
    expect(await unscoped.next()).toMatchObject({ type: "event", event: { type: "lamp.dimmed" } });
  });

  it("sends an event forwarded to one user only to that user's connections, and others to all", async () => {
    const ann = await connectSignedInAs(SIGNED_IN_FOR_TESTS, ["lamp.lit"]);
    const ben = await connectSignedInAs(ANOTHER_SIGNED_IN_FOR_TESTS, ["lamp.lit"]);
    const bensOtherTab = await connectSignedInAs(ANOTHER_SIGNED_IN_FOR_TESTS, ["lamp.lit"]);

    await bus.publish(new LampLitFor(ANOTHER_SIGNED_IN_FOR_TESTS.userId, "study"));
    await bus.publish(new LampLit("hall"));

    // Frames arrive in order, so Ann's first being the hall shows the study's was not sent to her.
    expect(await room(ann)).toBe("hall");
    for (const next of [ben, bensOtherTab]) {
      expect(await room(next)).toBe("study");
      expect(await room(next)).toBe("hall");
    }
  });

  it("refuses a message that is not a subscribe or unsubscribe", async () => {
    const { client, next } = await connect();

    client.send("lamp please");

    expect(await next()).toEqual({
      type: "refused",
      reason: "Not a subscribe or unsubscribe message.",
    });
  });

  it("counts the connections open, each until it closes", async () => {
    const stream = app.get(EventStream);
    const first = await connect();
    await connect();

    expect(stream.openConnections()).toBe(2);
    await new Promise<void>((resolve) => {
      first.client.addEventListener("close", () => resolve(), { once: true });
      first.client.close();
    });
    await expect.poll(() => stream.openConnections()).toBe(1);
  });

  it("refuses a WebSocket on another path", async () => {
    const client = new WsClient(`ws://127.0.0.1:${port}/api/elsewhere`);

    const refusedWith = await new Promise((resolve) => {
      client.on("unexpected-response", (_request, response) => resolve(response.statusCode));
      client.on("open", () => resolve("open"));
    });

    expect(refusedWith).toBe(404);
  });
});

describe("the web app's build", () => {
  @Global()
  @Module({
    providers: [{ provide: WebAppBuild, useValue: new WebAppBuild("0123456789abcdef") }],
    exports: [WebAppBuild],
  })
  class BuiltWebAppForTests {}

  let built: INestApplication;
  let builtPort: number;

  beforeEach(async () => {
    ({ app: built, port: builtPort } = await startTestApplication({
      imports: [EventsModule, EventStreamModule, BuiltWebAppForTests],
    }));
  });

  afterEach(async () => {
    await built.close();
  });

  it("is named in each reply to a subscription without a scope, never in a Thread's", async () => {
    const client = new WsClient(`ws://localhost:${builtPort}${EVENTS_PATH}`);
    const replies: Message[] = [];
    client.on("message", (data: Buffer) =>
      replies.push(messageSchema.parse(JSON.parse(data.toString()))),
    );
    await new Promise((resolve) => client.once("open", resolve));

    client.send(JSON.stringify({ type: "subscribe", events: ["lamp.lit"] }));
    client.send(JSON.stringify({ type: "subscribe", events: ["lamp.lit"], threadId: THREAD_A }));
    await expect.poll(() => replies.length).toBe(2);
    client.close();

    expect(replies).toEqual([
      { type: "subscriptions", events: ["lamp.lit"], webAppBuild: "0123456789abcdef" },
      { type: "subscriptions", events: ["lamp.lit"], threadId: THREAD_A },
    ]);
  });
});

describe("signed-in devices", () => {
  let guarded: INestApplication;
  let guardedPort: number;
  let devices: DevicesForTests;

  beforeEach(async () => {
    ({ app: guarded, port: guardedPort } = await startTestApplication({
      imports: [EventsModule, EventStreamModule, devicesForTests()],
      requestAccess: "guarded",
    }));
    devices = guarded.get(DevicesForTests);
  });

  afterEach(async () => {
    await guarded.close();
  });

  function connectAs(cookie: string | undefined): WsClient {
    return new WsClient(`ws://localhost:${guardedPort}${EVENTS_PATH}`, {
      headers: cookie === undefined ? {} : { cookie },
    });
  }

  it("refuses a WebSocket without a signed-in device, on localhost too", async () => {
    const signedOut = devices.signIn("signed-out");
    devices.signOut("signed-out");

    for (const cookie of [undefined, signedOut]) {
      const client = connectAs(cookie);
      const refusedWith = await new Promise((resolve) => {
        client.on("unexpected-response", (_request, response) => resolve(response.statusCode));
        client.on("open", () => resolve("open"));
      });

      expect(refusedWith).toBe(401);
    }
  });

  it("closes the WebSockets of a device once it is signed out, and only its own", async () => {
    const leaving = connectAs(devices.signIn("leaving"));
    const staying = connectAs(devices.signIn("staying"));
    await Promise.all(
      [leaving, staying].map((client) => new Promise((resolve) => client.once("open", resolve))),
    );
    const closedWith = new Promise((resolve) => leaving.once("close", (code) => resolve(code)));

    devices.signOut("leaving");

    expect(await closedWith).toBe(SIGNED_OUT);
    expect(staying.readyState).toBe(WsClient.OPEN);
    staying.close();
  });

  it("closes, within a minute, the WebSockets of a device signed out by another process", async () => {
    const schedule = guarded.get(Schedule) as ManualSchedule;
    const leaving = connectAs(devices.signIn("leaving"));
    const staying = connectAs(devices.signIn("staying"));
    await Promise.all(
      [leaving, staying].map((client) => new Promise((resolve) => client.once("open", resolve))),
    );
    const closedWith = new Promise((resolve) => leaving.once("close", (code) => resolve(code)));

    devices.signOutUntold("leaving");
    await schedule.advanceBy(SIGNED_IN_CHECK_EVERY_MS);

    expect(await closedWith).toBe(SIGNED_OUT);
    expect(staying.readyState).toBe(WsClient.OPEN);
    staying.close();
  });
});

describe("WebSocket routes", () => {
  let guarded: INestApplication;
  let guardedPort: number;
  let devices: DevicesForTests;
  const seen: { params: Record<string, string>; userId: string; frames: Buffer[] }[] = [];

  beforeEach(async () => {
    ({ app: guarded, port: guardedPort } = await startTestApplication({
      imports: [EventsModule, EventStreamModule, devicesForTests()],
      requestAccess: "guarded",
    }));
    devices = guarded.get(DevicesForTests);
    seen.length = 0;
    guarded
      .get(WebSocketRoutes)
      .register("/api/tasks/:taskId/devices/:deviceId/relay", (client, signedIn, params) => {
        seen.push({ params: { ...params }, userId: signedIn.userId, frames: [] });
        client.on("message", (data, isBinary) => {
          seen.at(-1)?.frames.push(data as Buffer);
          client.send(Buffer.from([...(data as Buffer)].toReversed()), { binary: isBinary });
        });
      });
  });

  afterEach(async () => {
    await guarded.close();
  });

  function connectTo(path: string, cookie?: string): WsClient {
    return new WsClient(`ws://localhost:${guardedPort}${path}`, {
      headers: cookie === undefined ? {} : { cookie },
    });
  }

  const RELAY = "/api/tasks/t1/devices/d%201/relay";

  it("upgrades a signed-in device on a registered path and gives the handler its params", async () => {
    const client = connectTo(RELAY, devices.signIn("phone"));

    expect(await statusOf(client)).toBe("open");
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toMatchObject({ params: { taskId: "t1", deviceId: "d 1" }, userId: "user" });
    client.close();
  });

  it("refuses a registered path without a signed-in device with 401", async () => {
    expect(await statusOf(connectTo(RELAY))).toBe(401);
    expect(seen).toEqual([]);
  });

  it("refuses an unknown path with 404, signed in or not, before asking who is signed in", async () => {
    expect(await statusOf(connectTo("/api/tasks/t1/relay"))).toBe(404);
    expect(await statusOf(connectTo("/api/tasks/t1/relay", devices.signIn("phone")))).toBe(404);
  });

  it("refuses to register the same pattern twice", () => {
    expect(() =>
      guarded.get(WebSocketRoutes).register("/api/tasks/:taskId/devices/:deviceId/relay", () => {}),
    ).toThrow("already registered");
  });

  it("closes a route's client once its device is signed out, and only its own", async () => {
    const leaving = connectTo(RELAY, devices.signIn("leaving"));
    const staying = connectTo(RELAY, devices.signIn("staying"));
    await Promise.all(
      [leaving, staying].map((client) => new Promise((resolve) => client.once("open", resolve))),
    );
    const closedWith = new Promise((resolve) => leaving.once("close", (code) => resolve(code)));

    devices.signOut("leaving");

    expect(await closedWith).toBe(SIGNED_OUT);
    expect(staying.readyState).toBe(WsClient.OPEN);
    staying.close();
  });

  it("closes a route's client within a minute of a sign-out another process made", async () => {
    const schedule = guarded.get(Schedule) as ManualSchedule;
    const leaving = connectTo(RELAY, devices.signIn("leaving"));
    await new Promise((resolve) => leaving.once("open", resolve));
    const closedWith = new Promise((resolve) => leaving.once("close", (code) => resolve(code)));

    devices.signOutUntold("leaving");
    await schedule.advanceBy(SIGNED_IN_CHECK_EVERY_MS);

    expect(await closedWith).toBe(SIGNED_OUT);
  });

  it("passes binary frames to the handler untouched, and its binary frames back", async () => {
    const client = connectTo(RELAY, devices.signIn("phone"));
    await new Promise((resolve) => client.once("open", resolve));
    const bytes = Buffer.from([0, 255, 1, 254, 128, 7]);
    const reply = new Promise<{ data: Buffer; isBinary: boolean }>((resolve) =>
      client.once("message", (data, isBinary) => resolve({ data: data as Buffer, isBinary })),
    );

    client.send(bytes, { binary: true });

    expect(await reply).toEqual({ data: Buffer.from([...bytes].toReversed()), isBinary: true });
    expect(seen[0]?.frames[0]?.equals(bytes)).toBe(true);
    client.close();
  });
});

function statusOf(client: WsClient): Promise<unknown> {
  return new Promise((resolve) => {
    client.on("unexpected-response", (_request, response) => resolve(response.statusCode));
    client.on("open", () => resolve("open"));
  });
}
