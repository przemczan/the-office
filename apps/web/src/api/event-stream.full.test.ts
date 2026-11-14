import type { ServerMessage, WebEvent } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventStream,
  RECONNECT_DELAYS_MS,
  SIGNED_OUT_CLOSE_CODE,
  type EventStreamOptions,
} from "./event-stream.ts";

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

  /** This device was signed out: the service closes its connection with 4401. */
  signedOut(): void {
    this.dispatchEvent(new CloseEvent("close", { code: SIGNED_OUT_CLOSE_CODE }));
  }

  /** The service went away, as on a restart: it closes its clients with 1001. */
  serviceGone(): void {
    this.dispatchEvent(new CloseEvent("close", { code: 1001 }));
  }
}

const EVENTS_URL = "ws://localhost:3000/api/events";
const TASK_STARTED: WebEvent = { type: "task.started", occurredAt: "2026-10-25T09:00:00.000Z" };
const THREAD_A = "0b6a2f4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const THREAD_B = "7e8f9a0b-1c2d-4e3f-9a4b-5c6d7e8f9a0b";
const OUTPUT = ["thread.process-output", "thread.sub-agent-messages"];

function outputOf(threadId: string): WebEvent {
  const event = { type: "thread.process-output", occurredAt: TASK_STARTED.occurredAt, threadId };
  return event;
}

let sockets: FakeWebSocket[];

function startStream(options: Partial<EventStreamOptions> = {}): EventStream {
  const eventStream = new EventStream({
    url: EVENTS_URL,
    eventTypes: ["task.started"],
    onEvent: () => undefined,
    onSubscribed: () => undefined,
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

  it("passes on each event with its own fields", () => {
    const onEvent = vi.fn<(event: WebEvent) => void>();
    startStream({ onEvent });
    latestSocket().open();
    const withFields = { ...TASK_STARTED, taskId: "f3c1b2a4-5d6e-4f70-8a9b-0c1d2e3f4a5b" };

    latestSocket().receive({ type: "event", event: withFields });

    expect(onEvent.mock.calls).toEqual([[withFields]]);
  });

  it("says the subscription is in place once the service confirms it, not when the socket opens", () => {
    const onSubscribed = vi.fn<() => void>();
    startStream({ onSubscribed });

    latestSocket().open();
    expect(onSubscribed).not.toHaveBeenCalled();
    latestSocket().receive({ type: "subscriptions", events: ["task.started"] });

    expect(onSubscribed).toHaveBeenCalledOnce();
  });

  it("says so once per connection, whatever the service replies later", () => {
    const onSubscribed = vi.fn<() => void>();
    startStream({ onSubscribed });
    latestSocket().open();

    latestSocket().receive({ type: "subscriptions", events: ["task.started"] });
    latestSocket().receive({ type: "subscriptions", events: ["task.started"] });

    expect(onSubscribed).toHaveBeenCalledOnce();
  });

  it("reconnects after the service went away, subscribes again and says so", () => {
    const onSubscribed = vi.fn<() => void>();
    const eventStream = startStream({ onSubscribed });
    latestSocket().open();
    latestSocket().receive({ type: "subscriptions", events: ["task.started"] });

    latestSocket().serviceGone();
    expect(eventStream.status()).toBe("reconnecting");
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
    latestSocket().open();
    latestSocket().receive({ type: "subscriptions", events: ["task.started"] });

    expect(sockets).toHaveLength(2);
    expect(latestSocket().sent).toEqual([{ type: "subscribe", events: ["task.started"] }]);
    expect(onSubscribed).toHaveBeenCalledTimes(2);
    expect(eventStream.status()).toBe("connected");
  });

  it("ignores what a socket it already left behind still says", () => {
    const onEvent = vi.fn<(event: WebEvent) => void>();
    const onSubscribed = vi.fn<() => void>();
    startStream({ onEvent, onSubscribed });
    const lost = latestSocket();
    lost.open();
    lost.serviceGone();

    lost.receive({ type: "subscriptions", events: ["task.started"] });
    lost.receive({ type: "event", event: TASK_STARTED });

    expect(onSubscribed).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
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

  it("tries again while the service has never answered, and says nothing until it subscribes", () => {
    const onSubscribed = vi.fn<() => void>();
    const eventStream = startStream({ onSubscribed });

    latestSocket().serviceGone();
    expect(eventStream.status()).toBe("reconnecting");
    vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
    latestSocket().open();

    expect(eventStream.status()).toBe("connected");
    expect(onSubscribed).not.toHaveBeenCalled();
  });

  it("tells its subscribers when the status changes", () => {
    const eventStream = startStream();
    const onChange = vi.fn<() => void>();
    eventStream.subscribe(onChange);

    latestSocket().open();
    latestSocket().serviceGone();

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  describe("for one Thread", () => {
    it("subscribes scoped to the Thread once connected, and unsubscribes so", () => {
      const eventStream = startStream();
      const unsubscribe = eventStream.subscribeToThread({
        threadId: THREAD_A,
        eventTypes: OUTPUT,
        onEvent: () => undefined,
      });
      latestSocket().open();

      unsubscribe();
      unsubscribe();

      expect(latestSocket().sent).toEqual([
        { type: "subscribe", events: ["task.started"] },
        { type: "subscribe", events: OUTPUT, threadId: THREAD_A },
        { type: "unsubscribe", events: OUTPUT, threadId: THREAD_A },
      ]);
    });

    it("subscribes at once while connected, and says so once the service confirms it", () => {
      const eventStream = startStream();
      latestSocket().open();
      latestSocket().receive({ type: "subscriptions", events: ["task.started"] });
      const onSubscribed = vi.fn<() => void>();

      eventStream.subscribeToThread({
        threadId: THREAD_A,
        eventTypes: OUTPUT,
        onEvent: () => undefined,
        onSubscribed,
      });
      expect(latestSocket().sent.at(-1)).toEqual({
        type: "subscribe",
        events: OUTPUT,
        threadId: THREAD_A,
      });
      expect(onSubscribed).not.toHaveBeenCalled();
      latestSocket().receive({ type: "subscriptions", events: OUTPUT, threadId: THREAD_A });

      expect(onSubscribed).toHaveBeenCalledOnce();
    });

    it("unsubscribes a type only once no subscription to the Thread has it", () => {
      const eventStream = startStream({ eventTypes: [] });
      latestSocket().open();
      const first = eventStream.subscribeToThread({
        threadId: THREAD_A,
        eventTypes: OUTPUT,
        onEvent: () => undefined,
      });
      const second = eventStream.subscribeToThread({
        threadId: THREAD_A,
        eventTypes: ["thread.process-output"],
        onEvent: () => undefined,
      });

      first();
      second();

      expect(latestSocket().sent.slice(2)).toEqual([
        { type: "unsubscribe", events: ["thread.sub-agent-messages"], threadId: THREAD_A },
        { type: "unsubscribe", events: ["thread.process-output"], threadId: THREAD_A },
      ]);
    });

    it("passes a subscription only its own Thread's events of its types", () => {
      const eventStream = startStream();
      const onEvent = vi.fn<(event: WebEvent) => void>();
      eventStream.subscribeToThread({ threadId: THREAD_A, eventTypes: OUTPUT, onEvent });
      latestSocket().open();

      latestSocket().receive({ type: "event", event: outputOf(THREAD_B) });
      latestSocket().receive({ type: "event", event: TASK_STARTED });
      latestSocket().receive({ type: "event", event: outputOf(THREAD_A) });

      expect(onEvent.mock.calls).toEqual([[outputOf(THREAD_A)]]);
    });

    it("subscribes again after a reconnect and says so again", () => {
      const onSubscribed = vi.fn<() => void>();
      const streamSubscribed = vi.fn<() => void>();
      const eventStream = startStream({ onSubscribed: streamSubscribed });
      eventStream.subscribeToThread({
        threadId: THREAD_A,
        eventTypes: OUTPUT,
        onEvent: () => undefined,
        onSubscribed,
      });
      eventStream.subscribeToThread({
        threadId: THREAD_B,
        eventTypes: ["thread.process-output"],
        onEvent: () => undefined,
      });
      latestSocket().open();
      latestSocket().receive({ type: "subscriptions", events: ["task.started"] });
      latestSocket().receive({ type: "subscriptions", events: OUTPUT, threadId: THREAD_A });

      latestSocket().serviceGone();
      vi.advanceTimersByTime(RECONNECT_DELAYS_MS[0]);
      latestSocket().open();
      latestSocket().receive({ type: "subscriptions", events: ["task.started"] });
      latestSocket().receive({ type: "subscriptions", events: OUTPUT, threadId: THREAD_A });

      expect(latestSocket().sent).toEqual([
        { type: "subscribe", events: ["task.started"] },
        { type: "subscribe", events: OUTPUT, threadId: THREAD_A },
        { type: "subscribe", events: ["thread.process-output"], threadId: THREAD_B },
      ]);
      expect(onSubscribed).toHaveBeenCalledTimes(2);
      expect(streamSubscribed).toHaveBeenCalledTimes(2);
    });

    it("does not subscribe again after a reconnect once unsubscribed", () => {
      const eventStream = startStream({ eventTypes: [] });
      const unsubscribe = eventStream.subscribeToThread({
        threadId: THREAD_A,
        eventTypes: OUTPUT,
        onEvent: () => undefined,
      });
      unsubscribe();
      latestSocket().open();

      expect(latestSocket().sent).toEqual([]);
    });
  });

  it("stops for good when stopped", () => {
    const eventStream = startStream();
    latestSocket().open();

    eventStream.stop();
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
  });

  it("stops, connecting no more, once the service closes it as this device was signed out", () => {
    const onSignedOut = vi.fn<() => void>();
    startStream({ onSignedOut });
    latestSocket().open();

    latestSocket().signedOut();
    vi.advanceTimersByTime(60_000);

    expect(onSignedOut).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
  });
});
