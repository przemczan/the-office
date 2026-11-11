import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import {
  clientMessageSchema,
  EVENTS_PATH,
  isThreadScopedEventType,
  type ClientMessage,
  type ServerMessage,
  type WebEvent,
} from "@the-office/contracts";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { DomainEvent } from "../events/domain-event.js";
import { EventBus, type Unsubscribe } from "../events/event-bus.js";
import { addressingOf, localRequestRefusal } from "../http/local-requests.js";
import { WebEventForwarding } from "./web-event-forwarding.js";

const GOING_AWAY = 1001;

/** A client's subscriptions: the event types without a scope, and those scoped to each Thread. */
interface Subscriptions {
  readonly unscoped: Set<string>;
  readonly byThread: Map<string, Set<string>>;
}

/**
 * The WebSocket at EVENTS_PATH, on the service's own HTTP server: each client subscribes to event
 * types and receives the domain events forwarded to the web as those types. A subscription may be
 * scoped to a Thread: it then receives the events of its type whose `threadId` is that Thread's.
 * A thread-scoped type (THREAD_SCOPED_EVENT_TYPES) goes only to subscriptions scoped to its
 * event's Thread, never to one without a scope; every other type goes to the subscriptions of its
 * type without a scope, and to those scoped to its `threadId` when it has one.
 */
@Injectable()
export class EventStream implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EventStream.name);
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private readonly subscriptions = new Map<WebSocket, Subscriptions>();
  private stopForwarding: Unsubscribe | undefined;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly eventBus: EventBus,
    private readonly webEventForwarding: WebEventForwarding,
  ) {}

  onApplicationBootstrap(): void {
    this.httpServer().on("upgrade", this.upgrade);
    this.stopForwarding = this.eventBus.subscribeToEveryEvent((event) => this.send(event));
  }

  // Before the HTTP server closes, which waits for every open connection to end.
  beforeApplicationShutdown(): void {
    this.stopForwarding?.();
    this.httpServer().off("upgrade", this.upgrade);
    for (const client of this.subscriptions.keys()) client.close(GOING_AWAY);
    this.webSocketServer.close();
  }

  private httpServer(): Server {
    return this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
  }

  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== EVENTS_PATH) {
      refuseUpgrade(socket, "404 Not Found");
      return;
    }
    const refusal = localRequestRefusal(addressingOf(request));
    if (refusal !== undefined) {
      this.logger.warn(`Refused a WebSocket: ${refusal}`);
      refuseUpgrade(socket, "403 Forbidden");
      return;
    }
    this.webSocketServer.handleUpgrade(request, socket, head, (client) => this.connect(client));
  };

  private connect(client: WebSocket): void {
    this.subscriptions.set(client, { unscoped: new Set(), byThread: new Map() });
    client.on("message", (data, isBinary) => this.receive(client, data, isBinary));
    client.on("close", () => this.subscriptions.delete(client));
    client.on("error", (error) => this.logger.warn(`A WebSocket failed: ${error.message}`));
  }

  private receive(client: WebSocket, data: RawData, isBinary: boolean): void {
    const message = isBinary ? undefined : parseClientMessage(data.toString());
    if (message === undefined) {
      sendTo(client, { type: "refused", reason: "Not a subscribe or unsubscribe message." });
      return;
    }
    const subscriptions = this.subscriptions.get(client);
    if (subscriptions === undefined) return;
    const { threadId } = message;
    const subscribed =
      threadId === undefined
        ? subscriptions.unscoped
        : (subscriptions.byThread.get(threadId) ?? new Set<string>());
    for (const eventType of message.events) {
      if (message.type === "subscribe") subscribed.add(eventType);
      else subscribed.delete(eventType);
    }
    if (threadId === undefined) {
      sendTo(client, { type: "subscriptions", events: [...subscribed].toSorted() });
      return;
    }
    if (subscribed.size > 0) subscriptions.byThread.set(threadId, subscribed);
    else subscriptions.byThread.delete(threadId);
    sendTo(client, { type: "subscriptions", events: [...subscribed].toSorted(), threadId });
  }

  private send(event: DomainEvent): void {
    const webEvent = this.webEventForwarding.toWebEvent(event);
    if (webEvent === undefined) return;
    for (const [client, subscriptions] of this.subscriptions) {
      if (receives(subscriptions, webEvent)) sendTo(client, { type: "event", event: webEvent });
    }
  }
}

function receives(subscriptions: Subscriptions, event: WebEvent): boolean {
  const threadId = "threadId" in event ? event.threadId : undefined;
  const scoped =
    typeof threadId === "string" && subscriptions.byThread.get(threadId)?.has(event.type) === true;
  if (isThreadScopedEventType(event.type)) return scoped;
  return scoped || subscriptions.unscoped.has(event.type);
}

function parseClientMessage(text: string): ClientMessage | undefined {
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function sendTo(client: WebSocket, message: ServerMessage): void {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
}

function refuseUpgrade(socket: Duplex, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
