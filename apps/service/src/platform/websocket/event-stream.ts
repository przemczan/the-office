import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  Injectable,
  Logger,
  Optional,
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
import { OfficeAddresses } from "../http/office-addresses.js";
import { SignedInRequests, type SignedIn } from "../http/signed-in-requests.js";
import { Schedule, type Wait } from "../schedule/schedule.js";
import { WebAppBuild } from "../web-app/web-app-build.js";
import { WebEventForwarding } from "./web-event-forwarding.js";
import { WebSocketRoutes, type WebSocketRouteHandler } from "./websocket-routes.js";

const GOING_AWAY = 1001;
const INTERNAL_ERROR = 1011;
/** Closes a client whose signed-in device was signed out (an application's own code, 4000–4999). */
export const SIGNED_OUT = 4401;
/** How often the open clients' devices are checked, as their last use is written (spec §2.10). */
export const SIGNED_IN_CHECK_EVERY_MS = 60 * 1000;

/**
 * A client's subscriptions: the event types without a scope, and those scoped to each Thread; and
 * the user and signed-in device it connected from.
 */
interface Subscriptions {
  readonly userId: string;
  readonly signedInDeviceId: string;
  readonly unscoped: Set<string>;
  readonly byThread: Map<string, Set<string>>;
}

/**
 * The WebSocket at EVENTS_PATH, on the service's own HTTP server: each client subscribes to event
 * types and receives the domain events forwarded to the web as those types. A subscription may be
 * scoped to a Thread: it then receives the events of its type whose `threadId` is that Thread's.
 * A thread-scoped type (THREAD_SCOPED_EVENT_TYPES) goes only to subscriptions scoped to its
 * event's Thread, never to one without a scope; every other type goes to the subscriptions of its
 * type without a scope, and to those scoped to its `threadId` when it has one. An event forwarded
 * to one user (`WebEventForwarding.forwardToUser`) goes only to that user's clients. Only a signed-in
 * device connects (spec §2.10), and its clients close once it is signed out. Each reply to a
 * subscription without a scope names the build of the web app the service serves, so a tab opened
 * on an earlier build offers to reload.
 */
@Injectable()
export class EventStream implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EventStream.name);
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private readonly subscriptions = new Map<WebSocket, Subscriptions>();
  /** The clients of the registered routes, each with its signed-in device. */
  private readonly routeClients = new Map<WebSocket, string>();
  private stopForwarding: Unsubscribe | undefined;
  private stopClosingSignedOut: Unsubscribe | undefined;
  private nextSignedInCheck: Wait | undefined;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly eventBus: EventBus,
    private readonly webEventForwarding: WebEventForwarding,
    private readonly officeAddresses: OfficeAddresses,
    private readonly signedInRequests: SignedInRequests,
    private readonly schedule: Schedule,
    private readonly webSocketRoutes: WebSocketRoutes,
    @Optional() private readonly webAppBuild: WebAppBuild = WebAppBuild.NONE,
  ) {}

  onApplicationBootstrap(): void {
    this.httpServer().on("upgrade", this.upgrade);
    this.stopForwarding = this.eventBus.subscribeToEveryEvent((event) => this.send(event));
    this.stopClosingSignedOut = this.signedInRequests.onSignedOut((signedInDeviceIds) =>
      this.closeSignedOut(signedInDeviceIds),
    );
    this.checkSignedInLater();
  }

  // Before the HTTP server closes, which waits for every open connection to end.
  beforeApplicationShutdown(): void {
    this.stopForwarding?.();
    this.stopClosingSignedOut?.();
    this.nextSignedInCheck?.cancel();
    this.nextSignedInCheck = undefined;
    this.httpServer().off("upgrade", this.upgrade);
    for (const client of [...this.subscriptions.keys(), ...this.routeClients.keys()]) {
      client.close(GOING_AWAY);
    }
    this.webSocketServer.close();
  }

  /** The browser tabs following The Office's events now, from every signed-in device. */
  openConnections(): number {
    return this.subscriptions.size;
  }

  private httpServer(): Server {
    return this.httpAdapterHost.httpAdapter.getHttpServer() as Server;
  }

  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // An unknown path answers 404 before any sign-in check, signed in or not.
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const route = pathname === EVENTS_PATH ? undefined : this.webSocketRoutes.match(pathname);
    if (pathname !== EVENTS_PATH && route === undefined) {
      refuseUpgrade(socket, "404 Not Found");
      return;
    }
    const refusal = this.officeAddresses.refusal(request);
    if (refusal !== undefined) {
      this.logger.warn(`Refused a WebSocket: ${refusal}`);
      refuseUpgrade(socket, "403 Forbidden");
      return;
    }
    void this.upgradeSignedIn(request, socket, head, route).catch((error: unknown) => {
      this.logger.error(`A WebSocket wasn't opened: ${String(error)}`);
      socket.destroy();
    });
  };

  private async upgradeSignedIn(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    route: { handler: WebSocketRouteHandler; params: Record<string, string> } | undefined,
  ): Promise<void> {
    let signedIn: SignedIn | undefined;
    try {
      signedIn = await this.signedInRequests.signedInOf(request);
    } catch (error) {
      this.logger.warn(`Refused a WebSocket: who is signed in was not found: ${String(error)}`);
      refuseUpgrade(socket, "503 Service Unavailable");
      return;
    }
    if (signedIn === undefined) {
      refuseUpgrade(socket, "401 Unauthorized");
      return;
    }
    const signedInUser = signedIn;
    this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
      if (route === undefined) this.connect(client, signedInUser);
      else this.connectRoute(client, signedInUser, route);
    });
  }

  private connect(client: WebSocket, { userId, signedInDeviceId }: SignedIn): void {
    this.subscriptions.set(client, {
      userId,
      signedInDeviceId,
      unscoped: new Set(),
      byThread: new Map(),
    });
    client.on("message", (data, isBinary) => this.receive(client, data, isBinary));
    client.on("close", () => this.subscriptions.delete(client));
    client.on("error", (error) => this.logger.warn(`A WebSocket failed: ${error.message}`));
  }

  /** Tracks the client with its device; its handler owns the messages, the stream reads none. */
  private connectRoute(
    client: WebSocket,
    signedIn: SignedIn,
    route: { handler: WebSocketRouteHandler; params: Record<string, string> },
  ): void {
    this.routeClients.set(client, signedIn.signedInDeviceId);
    client.on("close", () => this.routeClients.delete(client));
    client.on("error", (error) => this.logger.warn(`A WebSocket failed: ${error.message}`));
    try {
      route.handler(client, signedIn, route.params);
    } catch (error) {
      this.logger.warn(`A WebSocket route failed: ${String(error)}`);
      client.close(INTERNAL_ERROR);
    }
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
      const { id: webAppBuild } = this.webAppBuild;
      sendTo(client, {
        type: "subscriptions",
        events: [...subscribed].toSorted(),
        ...(webAppBuild !== undefined && { webAppBuild }),
      });
      return;
    }
    if (subscribed.size > 0) subscriptions.byThread.set(threadId, subscribed);
    else subscriptions.byThread.delete(threadId);
    sendTo(client, { type: "subscriptions", events: [...subscribed].toSorted(), threadId });
  }

  /**
   * `onSignedOut` tells only of sign-outs in this process; the recovery command signs devices out
   * from its own, and a device expires without an event. So each minute the stream asks which of
   * its clients' devices are still signed in.
   */
  private checkSignedInLater(): void {
    const at = new Date(this.schedule.now().getTime() + SIGNED_IN_CHECK_EVERY_MS);
    this.nextSignedInCheck = this.schedule.once("closing signed-out WebSockets", at, async () => {
      try {
        await this.closeSignedOutClients();
      } finally {
        if (this.nextSignedInCheck !== undefined) this.checkSignedInLater();
      }
    });
  }

  private async closeSignedOutClients(): Promise<void> {
    const signedInDeviceIds = new Set([
      ...[...this.subscriptions.values()].map(({ signedInDeviceId }) => signedInDeviceId),
      ...this.routeClients.values(),
    ]);
    if (signedInDeviceIds.size === 0) return;
    this.closeSignedOut(await this.signedInRequests.signedOutAmong([...signedInDeviceIds]));
  }

  private closeSignedOut(signedInDeviceIds: readonly string[]): void {
    for (const [client, { signedInDeviceId }] of this.subscriptions) {
      if (signedInDeviceIds.includes(signedInDeviceId)) client.close(SIGNED_OUT, "Signed out");
    }
    for (const [client, signedInDeviceId] of this.routeClients) {
      if (signedInDeviceIds.includes(signedInDeviceId)) client.close(SIGNED_OUT, "Signed out");
    }
  }

  private send(event: DomainEvent): void {
    const webEvent = this.webEventForwarding.toWebEvent(event);
    if (webEvent === undefined) return;
    const recipient = this.webEventForwarding.recipientOf(event);
    for (const [client, subscriptions] of this.subscriptions) {
      if (recipient !== undefined && subscriptions.userId !== recipient) continue;
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
