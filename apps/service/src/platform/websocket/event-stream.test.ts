import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { EVENTS_PATH, serverMessageSchema, webEventSchema } from "@the-office/contracts";
import { WebSocket as WsClient } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DomainEvent } from "../events/domain-event.js";
import { EventBus } from "../events/event-bus.js";
import { EventsModule } from "../events/events.module.js";
import { configureHttp } from "../http/configure-http.js";
import { EventStreamModule } from "./event-stream.module.js";
import { WebEventForwarding } from "./web-event-forwarding.js";

// No module forwards events yet, so the test brings its own, through the same path a module uses.
class LampLit extends DomainEvent {
  constructor(readonly room: string) {
    super(new Date("2026-10-25T09:00:00.000Z"));
  }
}
class LampDimmed extends DomainEvent {}
class LampMoved extends DomainEvent {}

const lampLitSchema = webEventSchema.extend({ type: z.literal("lamp.lit"), room: z.string() });
const lampDimmedSchema = webEventSchema.extend({ type: z.literal("lamp.dimmed") });
const messageSchema = serverMessageSchema(
  z.discriminatedUnion("type", [lampLitSchema, lampDimmedSchema]),
);
type Message = z.infer<typeof messageSchema>;

let app: INestApplication;
let bus: EventBus;
let port: number;
const clients: WebSocket[] = [];

beforeEach(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [EventsModule, EventStreamModule],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  configureHttp(app);
  await app.listen(0, "127.0.0.1");
  port = Number(new URL(await app.getUrl()).port);
  bus = app.get(EventBus);
  const forwarding = app.get(WebEventForwarding);
  forwarding.forward(LampLit, (event) => ({ type: "lamp.lit", room: event.room }));
  forwarding.forward(LampDimmed, () => ({ type: "lamp.dimmed" }));
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

async function changeSubscription(
  client: WebSocket,
  next: () => Promise<Message>,
  type: "subscribe" | "unsubscribe",
  events: string[],
): Promise<Message> {
  client.send(JSON.stringify({ type, events }));
  return next();
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

  it("leaves out unsubscribed types and events nobody forwards", async () => {
    const { client, next } = await connect();
    await changeSubscription(client, next, "subscribe", ["lamp.dimmed"]);

    await bus.publish(new LampLit("hall"));
    await bus.publish(new LampMoved());
    await bus.publish(new LampDimmed());

    // Frames arrive in order, so the dimmed event coming first shows the others were not sent.
    expect(await next()).toMatchObject({ type: "event", event: { type: "lamp.dimmed" } });
  });

  it("stops delivering a type after unsubscribe", async () => {
    const { client, next } = await connect();
    await changeSubscription(client, next, "subscribe", ["lamp.lit", "lamp.dimmed"]);

    expect(await changeSubscription(client, next, "unsubscribe", ["lamp.lit"])).toEqual({
      type: "subscriptions",
      events: ["lamp.dimmed"],
    });
    await bus.publish(new LampLit("hall"));
    await bus.publish(new LampDimmed());

    expect(await next()).toMatchObject({ type: "event", event: { type: "lamp.dimmed" } });
  });

  it("sends a closed client nothing and keeps delivering to the others", async () => {
    const closing = await connect();
    const staying = await connect();
    await changeSubscription(closing.client, closing.next, "subscribe", ["lamp.lit"]);
    await changeSubscription(staying.client, staying.next, "subscribe", ["lamp.lit"]);
    await new Promise((resolve) => {
      closing.client.addEventListener("close", resolve, { once: true });
      closing.client.close();
    });

    await bus.publish(new LampLit("hall"));

    expect(await staying.next()).toMatchObject({ type: "event", event: { room: "hall" } });
  });

  it("refuses a message that is not a subscribe or unsubscribe", async () => {
    const { client, next } = await connect();

    client.send("lamp please");

    expect(await next()).toEqual({
      type: "refused",
      reason: "Not a subscribe or unsubscribe message.",
    });
  });

  it("closes open clients as going away when the service shuts down", async () => {
    const { client } = await connect();
    const closed = new Promise<number>((resolve) =>
      client.addEventListener("close", (event) => resolve(event.code), { once: true }),
    );

    await app.close();

    expect(await closed).toBe(1001);
  });

  it.each([
    ["from another site's page", { origin: "https://evil.example" }, 403],
    ["addressed to another name", { headers: { host: "evil.example" } }, 403],
  ])("refuses a WebSocket %s", async (_, options, status) => {
    const client = new WsClient(`ws://127.0.0.1:${port}${EVENTS_PATH}`, options);

    const refusedWith = await new Promise((resolve) => {
      client.on("unexpected-response", (_request, response) => resolve(response.statusCode));
      client.on("open", () => resolve("open"));
    });

    expect(refusedWith).toBe(status);
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
