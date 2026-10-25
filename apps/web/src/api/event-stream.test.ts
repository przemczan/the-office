import type { ServerMessage, WebEvent } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStream, RECONNECT_DELAYS_MS, type EventStreamOptions } from "./event-stream.ts";

/** A WebSocket the test opens, feeds and closes as the service would. */
class FakeWebSocket extends EventTarget {
  readonly sent: unknown[] = [];

  constructor(readonly url: string) {
    super();
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.dispatchEvent(new CloseEvent("close", { code: 1000 }));
  }

  open(): void {
    this.dispatchEvent(new Event("open"));
  }

  receive(message: ServerMessage | string): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  /** The service went away, as on a restart: it closes its clients with 1001. */
  serviceGone(): void {
    this.dispatchEvent(new CloseEvent("close", { code: 1001 }));
  }
}

const EVENTS_URL = "ws://localhost:3000/api/events";
const TASK_STARTED: WebEvent = { type: "task.started", occurredAt: "2026-10-25T09:00:00.000Z" };

let sockets: FakeWebSocket[];

function startStream(options: Partial<EventStreamOptions> = {}): EventStream {
  const eventStream = new EventStream({
    url: EVENTS_URL,
    eventTypes: ["task.started"],
    onEvent: () => undefined,
    onReconnected: () => undefined,
    ...options,
    openWebSocket: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  eventStream.start();
  return eventStream;
}

function latestSocket(): FakeWebSocket {
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error("No WebSocket was opened.");
  return socket;
}

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the event stream", () => {
  it("subscribes to its event types once connected", () => {
    const eventStream = startStream();
    expect(eventStream.status()).toBe("connecting");

    latestSocket().open();

    expect(latestSocket().url).toBe(EVENTS_URL);
    expect(latestSocket().sent).toEqual([{ type: "subscribe", events: ["task.started"] }]);
    expect(eventStream.status()).toBe("connected");
  });

  it("passes on the events it receives and nothing else", () => {
    const onEvent = vi.fn<(event: WebEvent) => void>();
    startStream({ onEvent });
    latestSocket().open();

    latestSocket().receive({ type: "subscriptions", events: ["task.started"] });
    latestSocket().receive("not json");
    latestSocket().receive({ type: "event", event: TASK_STARTED });

    expect(onEvent.mock.calls).toEqual([[TASK_STARTED]]);
  });

  it("reconnects after the service went away, subscribes again and says so", () => {
    const onReconnected = vi.fn<() => void>();
    const eventStream = startStream({ onReconnected });
    latestSocket().open();

    latestSocket().serviceGone();
    expect(eventStream.status()).toBe("reconnecting");
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
    latestSocket().open();

    expect(sockets).toHaveLength(2);
    expect(latestSocket().sent).toEqual([{ type: "subscribe", events: ["task.started"] }]);
    expect(onReconnected).toHaveBeenCalledOnce();
    expect(eventStream.status()).toBe("connected");
  });

  it("waits longer after each failed attempt, up to its longest wait", () => {
    startStream();
    latestSocket().open();
    latestSocket().serviceGone();

    for (const delay of [...RECONNECT_DELAYS_MS, RECONNECT_DELAYS_MS.at(-1)!]) {
      const attempts = sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(attempts);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(attempts + 1);
      latestSocket().serviceGone();
    }
  });

  it("tries again while the service has never answered, without a refetch", () => {
    const onReconnected = vi.fn<() => void>();
    const eventStream = startStream({ onReconnected });

    latestSocket().serviceGone();
    expect(eventStream.status()).toBe("reconnecting");
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
    latestSocket().open();

    expect(eventStream.status()).toBe("connected");
    expect(onReconnected).not.toHaveBeenCalled();
  });

  it("tells its subscribers when the status changes", () => {
    const eventStream = startStream();
    const onChange = vi.fn<() => void>();
    eventStream.subscribe(onChange);

    latestSocket().open();
    latestSocket().serviceGone();

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("stops for good when stopped", () => {
    const eventStream = startStream();
    latestSocket().open();

    eventStream.stop();
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
  });
});
