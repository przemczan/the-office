import {
  serverMessageSchema,
  webEventSchema,
  type ClientMessage,
  type ServerMessage,
  type WebEvent,
} from "@the-office/contracts";

/**
 * Stopped before it starts, once stopped and once the service signed this device out; connecting
 * while the first attempt is under way; reconnecting after an attempt failed or a connection was
 * lost, such as when the service restarts.
 */
export type EventStreamStatus = "stopped" | "connecting" | "connected" | "reconnecting";

export interface EventStreamOptions {
  readonly url: string;
  /** The event types to receive, subscribed again on every connection. */
  readonly eventTypes: readonly string[];
  readonly onEvent: (event: WebEvent) => void;
  /**
   * A connection's subscription is in place, as the service's reply to it says: the events sent
   * before it, while connecting or while a lost connection was down, are lost. Called once per
   * connection, the first one included.
   */
  readonly onSubscribed: () => void;
  /**
   * The service closed the connection as this device was signed out (`SIGNED_OUT_CLOSE_CODE`): the
   * stream stops, connecting again only once started again.
   */
  readonly onSignedOut?: () => void;
  readonly openWebSocket?: (url: string) => WebSocket;
}

/**
 * Event types to receive for one Thread only, as long as a page shows it: the only way to receive
 * a thread-scoped type (THREAD_SCOPED_EVENT_TYPES), and for any other type, that Thread's events
 * of it alone.
 */
export interface ThreadSubscription {
  readonly threadId: string;
  readonly eventTypes: readonly string[];
  /** Each event of those types for that Thread; the stream's own `onEvent` receives it too. */
  readonly onEvent: (event: WebEvent) => void;
  /**
   * The subscription is in place, as the service's reply to it says: called once per connection,
   * so a page reads again what a lost connection missed.
   */
  readonly onSubscribed?: () => void;
}

/** The close code the service ends a signed-out device's connection with (spec §2.10). */
export const SIGNED_OUT_CLOSE_CODE = 4401;

/** The waits before each attempt to connect again, the last one repeated. */
export const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000] as const;

// Loose, so each event keeps its own fields for the module that reads it.
const serverMessage = serverMessageSchema(webEventSchema.loose());

/** The service's domain events, received over the WebSocket at EVENTS_PATH. */
export class EventStream {
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private failedAttempts = 0;
  /** The socket whose subscription the service confirmed, so its later replies change nothing. */
  private subscribedSocket: WebSocket | undefined;
  private running = false;
  private currentStatus: EventStreamStatus = "stopped";
  /** The web app's build the service named first in this tab, the one the tab runs. */
  private firstWebAppBuild: string | undefined;
  private webAppReplaced = false;
  private readonly listeners = new Set<() => void>();
  private readonly threadSubscriptions = new Set<ThreadSubscription>();
  /**
   * For each message sent on the current socket and not yet answered, in order, the Thread
   * subscriptions its reply puts in place: the service answers every message, in order.
   */
  private awaitingReplies: (readonly ThreadSubscription[])[] = [];

  constructor(private readonly options: EventStreamOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.failedAttempts = 0;
    this.setStatus("connecting");
    this.connect();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = undefined;
    this.setStatus("stopped");
    socket?.close();
  }

  readonly status = (): EventStreamStatus => this.currentStatus;

  /**
   * The service now serves another build of the web app than the one it named first in this tab:
   * The Office was updated since the page opened, and the page runs the build before.
   */
  readonly webAppUpdated = (): boolean => this.webAppReplaced;

  /**
   * Calls `onChange` when the status or `webAppUpdated` changes, until the returned function is
   * called.
   */
  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  /**
   * Receives the subscription's event types for its Thread, subscribed again on every connection,
   * until the returned function is called. Subscriptions to the same Thread share the service's:
   * a type is unsubscribed once none of them has it.
   */
  subscribeToThread(subscription: ThreadSubscription): () => void {
    const own = { ...subscription };
    this.threadSubscriptions.add(own);
    const socket = this.connectedSocket();
    if (socket !== undefined && own.eventTypes.length > 0) {
      this.send(
        socket,
        { type: "subscribe", events: [...own.eventTypes], threadId: own.threadId },
        [own],
      );
    }
    return () => {
      if (!this.threadSubscriptions.delete(own)) return;
      const kept = this.threadEventTypes(own.threadId);
      const dropped = own.eventTypes.filter((eventType) => !kept.has(eventType));
      const current = this.connectedSocket();
      if (current === undefined || dropped.length === 0) return;
      this.send(current, { type: "unsubscribe", events: dropped, threadId: own.threadId }, []);
    };
  }

  /**
   * The socket to send on now: only an open one, as sending on one still connecting throws. A
   * subscription made meanwhile is sent once it opens (`opened`), with every other one held.
   */
  private connectedSocket(): WebSocket | undefined {
    const socket = this.socket;
    return this.currentStatus === "connected" && socket?.readyState === WebSocket.OPEN
      ? socket
      : undefined;
  }

  private threadEventTypes(threadId: string): Set<string> {
    const eventTypes = new Set<string>();
    for (const subscription of this.threadSubscriptions) {
      if (subscription.threadId === threadId) {
        for (const eventType of subscription.eventTypes) eventTypes.add(eventType);
      }
    }
    return eventTypes;
  }

  private send(
    socket: WebSocket,
    message: ClientMessage,
    putsInPlace: readonly ThreadSubscription[],
  ): void {
    socket.send(JSON.stringify(message));
    this.awaitingReplies.push(putsInPlace);
  }

  private connect(): void {
    const socket = (this.options.openWebSocket ?? openBrowserWebSocket)(this.options.url);
    this.socket = socket;
    socket.addEventListener("open", () => this.opened(socket));
    socket.addEventListener("message", (message) => this.received(socket, message.data));
    // Every close is a lost connection, the service's own shutdown (1001) included.
    socket.addEventListener("close", (event) => this.closed(socket, event.code));
  }

  private opened(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.failedAttempts = 0;
    this.awaitingReplies = [];
    if (this.options.eventTypes.length > 0) {
      this.send(socket, { type: "subscribe", events: [...this.options.eventTypes] }, []);
    }
    for (const threadId of new Set([...this.threadSubscriptions].map((s) => s.threadId))) {
      const events = [...this.threadEventTypes(threadId)];
      const putsInPlace = [...this.threadSubscriptions].filter((s) => s.threadId === threadId);
      if (events.length > 0)
        this.send(socket, { type: "subscribe", events, threadId }, putsInPlace);
    }
    this.setStatus("connected");
  }

  private received(socket: WebSocket, data: unknown): void {
    if (socket !== this.socket || typeof data !== "string") return;
    const message = parseServerMessage(data);
    if (message?.type === "event") this.passOn(message.event);
    else if (message?.type === "subscriptions" || message?.type === "refused") {
      const putsInPlace = this.awaitingReplies.shift() ?? [];
      if (message.type === "refused") return;
      if (message.threadId === undefined) {
        this.heardWebAppBuild(message.webAppBuild);
        this.subscribed(socket);
      }
      for (const subscription of putsInPlace) {
        if (this.threadSubscriptions.has(subscription)) subscription.onSubscribed?.();
      }
    }
  }

  private passOn(event: WebEvent): void {
    this.options.onEvent(event);
    const threadId = "threadId" in event ? event.threadId : undefined;
    if (typeof threadId !== "string") return;
    for (const subscription of this.threadSubscriptions) {
      if (subscription.threadId === threadId && subscription.eventTypes.includes(event.type)) {
        subscription.onEvent(event);
      }
    }
  }

  /** A service serving the web app's source, as `npm run dev` does, names no build. */
  private heardWebAppBuild(build: string | undefined): void {
    if (build === undefined || this.webAppReplaced) return;
    if (this.firstWebAppBuild === undefined) {
      this.firstWebAppBuild = build;
    } else if (build !== this.firstWebAppBuild) {
      this.webAppReplaced = true;
      this.tellListeners();
    }
  }

  private subscribed(socket: WebSocket): void {
    if (socket === this.subscribedSocket) return;
    this.subscribedSocket = socket;
    this.options.onSubscribed();
  }

  private closed(socket: WebSocket, code: number): void {
    if (socket !== this.socket || !this.running) return;
    this.socket = undefined;
    if (code === SIGNED_OUT_CLOSE_CODE) {
      this.running = false;
      this.setStatus("stopped");
      this.options.onSignedOut?.();
      return;
    }
    this.setStatus("reconnecting");
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.failedAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.failedAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: EventStreamStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    this.tellListeners();
  }

  private tellListeners(): void {
    for (const listener of this.listeners) listener();
  }
}

function openBrowserWebSocket(url: string): WebSocket {
  return new WebSocket(url);
}

function parseServerMessage(text: string): ServerMessage | undefined {
  try {
    const result = serverMessage.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
