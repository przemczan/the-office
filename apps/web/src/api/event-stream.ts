import {
  serverMessageSchema,
  webEventSchema,
  type ClientMessage,
  type ServerMessage,
  type WebEvent,
} from "@the-office/contracts";

/**
 * Connecting while the first attempt is under way; reconnecting after an attempt failed or a
 * connection was lost, such as when the service restarts.
 */
export type EventStreamStatus = "connecting" | "connected" | "reconnecting";

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
  readonly openWebSocket?: (url: string) => WebSocket;
}

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
  private currentStatus: EventStreamStatus = "connecting";
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: EventStreamOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
  }

  readonly status = (): EventStreamStatus => this.currentStatus;

  /** Calls `onChange` when the status changes, until the returned function is called. */
  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  private connect(): void {
    const socket = (this.options.openWebSocket ?? openBrowserWebSocket)(this.options.url);
    this.socket = socket;
    socket.addEventListener("open", () => this.opened(socket));
    socket.addEventListener("message", (message) => this.received(socket, message.data));
    // Every close is a lost connection, the service's own shutdown (1001) included.
    socket.addEventListener("close", () => this.closed(socket));
  }

  private opened(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.failedAttempts = 0;
    if (this.options.eventTypes.length > 0) {
      const subscribe: ClientMessage = { type: "subscribe", events: [...this.options.eventTypes] };
      socket.send(JSON.stringify(subscribe));
    }
    this.setStatus("connected");
  }

  private received(socket: WebSocket, data: unknown): void {
    if (socket !== this.socket || typeof data !== "string") return;
    const message = parseServerMessage(data);
    if (message?.type === "event") this.options.onEvent(message.event);
    else if (message?.type === "subscriptions") this.subscribed(socket);
  }

  private subscribed(socket: WebSocket): void {
    if (socket === this.subscribedSocket) return;
    this.subscribedSocket = socket;
    this.options.onSubscribed();
  }

  private closed(socket: WebSocket): void {
    if (socket !== this.socket || !this.running) return;
    this.socket = undefined;
    this.setStatus("reconnecting");
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.failedAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.failedAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: EventStreamStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
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
