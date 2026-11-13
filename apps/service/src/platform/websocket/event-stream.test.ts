import type { INestApplication } from "@nestjs/common";
import { EVENTS_PATH } from "@the-office/contracts";
import { WebSocket as WsClient } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { EventBus } from "../events/event-bus.js";
import { EventsModule } from "../events/events.module.js";
import { SIGNED_OUT } from "./event-stream.js";
import { EventStreamModule } from "./event-stream.module.js";
import { WebEventForwarding } from "./web-event-forwarding.js";
import {
  devicesForTests,
  DevicesForTests,
  LampLit,
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

beforeEach(async () => {
  ({ app, port } = await startTestApplication({ imports: [EventsModule, EventStreamModule] }));
  bus = app.get(EventBus);
  const forwarding = app.get(WebEventForwarding);
  forwarding.forward(LampLit, (event) => ({ type: "lamp.lit", room: event.room }));
  forwarding.forward(LampDimmed, () => ({ type: "lamp.dimmed" }));
  forwardThreadEvents(forwarding);
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
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

  it("refuses a message that is not a subscribe or unsubscribe", async () => {
    const { client, next } = await connect();

    client.send("lamp please");

    expect(await next()).toEqual({
      type: "refused",
      reason: "Not a subscribe or unsubscribe message.",
    });
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
});
