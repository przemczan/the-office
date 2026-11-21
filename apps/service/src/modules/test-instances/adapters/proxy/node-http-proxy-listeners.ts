import {
  Agent,
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import type { RunningTestInstance } from "../../application/running-test-instances.js";
import { RunningTestInstances } from "../../application/running-test-instances.js";
import { TestInstanceHandOffs } from "../../application/test-instance-hand-offs.js";
import { OfficePort } from "../../application/test-instance-limits.js";
import { OfficeHost } from "../../application/test-instance-proxy.js";
import { ProxyListeners } from "../../ports/proxy-listeners.js";
import {
  appCookieHeader,
  browserSetCookie,
  cookieValue,
  instanceCookie,
  instanceCookieName,
} from "./proxy-cookies.js";
import { addressedToProxy, hostnameOf } from "./proxy-hosts.js";
import {
  appDidNotAnswerPage,
  notRunningPage,
  openFromTheOfficePage,
  usedLinkPage,
  type OfficeLink,
  type ProxyPage,
} from "./proxy-pages.js";

/** Where the hand-off link points, at the instance's Proxy port; the app never sees it. */
export const HAND_OFF_PATH = "/__office/hand-off";

/** Headers of one hop only, never passed on (RFC 9110 §7.6.1); an upgrade keeps its own two. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** A Proxy port's listener, with every connection it holds, so a close ends them at once. */
interface Listener {
  readonly server: Server;
  readonly sockets: Set<Duplex>;
  readonly agent: Agent;
}

/** What a request at a Proxy port gets, before anything reaches the app. */
type Gate =
  | { readonly kind: "misdirected" }
  | { readonly kind: "page"; readonly page: ProxyPage }
  | { readonly kind: "signed-in"; readonly setCookie: string }
  | {
      readonly kind: "forward";
      readonly instance: RunningTestInstance;
      readonly appPort: number;
    };

/**
 * The test-instance proxy on `node:http` (spec §5.1, "The test instance proxy"; §2.10, "Signing in
 * to a test instance"). At each Proxy port, on `OFFICE_HOST`: a Host other than the port's own
 * addresses gets a plain 421; a port no Running instance holds gets the 503 page; the hand-off
 * link is exchanged for the instance's cookie and a 303 to `/`, or gets the 403 page; a request
 * without that cookie gets the 401 page. Every other request and WebSocket upgrade goes to the
 * app at `127.0.0.1:<hostPort>`, addressed to `localhost:<the target's port>`, with only the app's
 * own cookies, and counts as the instance's activity; an app that doesn't answer gets the 502 page.
 */
@Injectable()
export class NodeHttpProxyListeners extends ProxyListeners {
  private readonly logger = new Logger(NodeHttpProxyListeners.name);
  private readonly listeners = new Map<number, Listener>();
  /** Each port's opens and closes, one after another. */
  private readonly queues = new Map<number, Promise<void>>();

  constructor(
    private readonly running: RunningTestInstances,
    private readonly handOffs: TestInstanceHandOffs,
    private readonly officeHost: OfficeHost,
    private readonly officePort: OfficePort,
  ) {
    super();
  }

  open(port: number): Promise<void> {
    return this.queued(port, () => this.listen(port));
  }

  close(port: number): Promise<void> {
    return this.queued(port, () => this.shut(port));
  }

  async closeAll(): Promise<void> {
    const ports = new Set([...this.listeners.keys(), ...this.queues.keys()]);
    await Promise.all([...ports].map((port) => this.close(port)));
  }

  listening(): readonly number[] {
    return [...this.listeners.keys()];
  }

  private queued(port: number, work: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(port) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.queues.set(port, next);
    void next
      .finally(() => {
        if (this.queues.get(port) === next) this.queues.delete(port);
      })
      .catch(() => undefined);
    return next;
  }

  private async listen(port: number): Promise<void> {
    if (this.listeners.has(port)) return;
    const sockets = new Set<Duplex>();
    const agent = new Agent({ keepAlive: true });
    const server = createServer((request, response) => {
      this.answer(port, agent, request, response);
    });
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      this.upgrade(port, sockets, request, socket, head);
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, this.officeHost.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.on("error", (error) => {
      this.logger.warn(`The test-instance proxy on port ${port} failed.`, error);
    });
    this.listeners.set(port, { server, sockets, agent });
  }

  private async shut(port: number): Promise<void> {
    const listener = this.listeners.get(port);
    if (!listener) return;
    this.listeners.delete(port);
    const closed = new Promise<void>((resolve) => listener.server.close(() => resolve()));
    listener.server.closeAllConnections();
    for (const socket of listener.sockets) socket.destroy();
    listener.agent.destroy();
    await closed;
  }

  private gate(port: number, request: IncomingMessage): Gate {
    const addressed = addressedToProxy(request.headers.host, {
      officeHost: this.officeHost.host,
      localAddress: request.socket.localAddress ?? "",
      port,
    });
    if (!addressed) return { kind: "misdirected" };
    const link = this.linkOf(request, port);
    const instance = this.running.byPort(port);
    const appPort = instance === undefined ? undefined : this.running.appPortOf(instance.id);
    if (instance === undefined || appPort === undefined) {
      return { kind: "page", page: notRunningPage(link) };
    }
    const url = new URL(request.url ?? "/", "http://proxy.invalid");
    if (url.pathname === HAND_OFF_PATH) {
      const value = this.handOffs.exchange(instance.id, url.searchParams.get("t") ?? "");
      return value === undefined
        ? { kind: "page", page: usedLinkPage(link) }
        : { kind: "signed-in", setCookie: instanceCookie(instance.id, value) };
    }
    const session = cookieValue(request.headers.cookie, instanceCookieName(instance.id));
    if (!this.handOffs.admits(instance.id, session)) {
      return { kind: "page", page: openFromTheOfficePage(link) };
    }
    return { kind: "forward", instance, appPort };
  }

  private answer(
    port: number,
    agent: Agent,
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const gate = this.gate(port, request);
    if (gate.kind === "misdirected") {
      response.writeHead(421, { "content-type": "text/plain; charset=utf-8" });
      response.end("Misdirected Request\n");
      return;
    }
    if (gate.kind === "page") {
      sendPage(response, gate.page);
      return;
    }
    if (gate.kind === "signed-in") {
      // A 303, so the token leaves the address bar and the history.
      response.writeHead(303, {
        location: "/",
        "set-cookie": gate.setCookie,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      });
      response.end();
      return;
    }
    const { instance, appPort } = gate;
    this.running.recordActivity(instance.id);
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: instance.hostPort,
      method: request.method,
      path: request.url,
      headers: appHeaders(request, instance.id, appPort, false),
      agent,
    });
    upstream.on("response", (answer) => {
      response.writeHead(
        answer.statusCode ?? 502,
        answer.statusMessage,
        browserHeaders(answer.headers, request, instance, appPort, false),
      );
      answer.pipe(response);
    });
    upstream.on("error", () => {
      if (response.headersSent) response.destroy();
      else sendPage(response, appDidNotAnswerPage(this.linkOf(request, port)));
    });
    request.on("error", () => upstream.destroy());
    response.on("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
  }

  private upgrade(
    port: number,
    sockets: Set<Duplex>,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    socket.on("error", () => socket.destroy());
    const gate = this.gate(port, request);
    if (gate.kind === "misdirected") {
      endRaw(
        socket,
        421,
        "Misdirected Request",
        "text/plain; charset=utf-8",
        "Misdirected Request\n",
      );
      return;
    }
    if (gate.kind === "page") {
      endRaw(socket, gate.page.status, "", "text/html; charset=utf-8", gate.page.html);
      return;
    }
    if (gate.kind === "signed-in") {
      endRaw(socket, 400, "Bad Request", "text/plain; charset=utf-8", "Bad Request\n");
      return;
    }
    const { instance, appPort } = gate;
    this.running.recordActivity(instance.id);
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: instance.hostPort,
      method: request.method,
      path: request.url,
      headers: appHeaders(request, instance.id, appPort, true),
    });
    upstream.on("upgrade", (answer, appSocket, appHead) => {
      sockets.add(appSocket);
      const end = (): void => {
        socket.destroy();
        appSocket.destroy();
        sockets.delete(appSocket);
      };
      appSocket.on("error", end);
      appSocket.on("close", end);
      socket.on("close", end);
      socket.write(
        rawHead(
          answer.statusCode ?? 101,
          answer.statusMessage ?? "Switching Protocols",
          browserHeaders(answer.headers, request, instance, appPort, true),
        ),
      );
      if (appHead.length > 0) socket.write(appHead);
      if (head.length > 0) appSocket.write(head);
      // Each message from the browser is activity too, so a page that only talks over its
      // WebSocket isn't stopped for Idle time.
      socket.on("data", () => this.running.recordActivity(instance.id));
      appSocket.pipe(socket);
      socket.pipe(appSocket);
    });
    upstream.on("response", (answer) => {
      const headers = browserHeaders(answer.headers, request, instance, appPort, false);
      socket.write(
        rawHead(answer.statusCode ?? 502, answer.statusMessage ?? "", {
          ...headers,
          connection: "close",
        }),
      );
      answer.pipe(socket);
    });
    upstream.on("error", () => {
      const page = appDidNotAnswerPage(this.linkOf(request, port));
      endRaw(socket, page.status, "Bad Gateway", "text/html; charset=utf-8", page.html);
    });
    upstream.end();
  }

  /** The Office, at the hostname the browser reached this port at. */
  private linkOf(request: IncomingMessage, port: number): OfficeLink {
    const hostname = hostnameOf(request.headers.host ?? "localhost");
    return { officeUrl: `http://${hostname}:${this.officePort.port}/`, port };
  }
}

/**
 * The request's headers as the app gets them: addressed to the instance's own address,
 * `localhost` at its target's port, with only its own cookies, and no hop-by-hop headers but an
 * upgrade's.
 */
function appHeaders(
  request: IncomingMessage,
  instanceId: string,
  appPort: number,
  upgrading: boolean,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || HOP_BY_HOP.has(name)) continue;
    if (name === "host" || name === "origin" || name === "cookie") continue;
    headers[name] = value;
  }
  headers.host = `localhost:${appPort}`;
  if (request.headers.origin !== undefined) headers.origin = `http://localhost:${appPort}`;
  const cookie = appCookieHeader(request.headers.cookie, instanceId);
  if (cookie !== undefined) headers.cookie = cookie;
  if (upgrading) {
    headers.connection = "Upgrade";
    if (request.headers.upgrade !== undefined) headers.upgrade = request.headers.upgrade;
  }
  return headers;
}

/**
 * The app's answer's headers as the browser gets them: its cookies namespaced, a redirect to the
 * app's own address pointed at the Proxy port, and no hop-by-hop headers but an upgrade's.
 */
function browserHeaders(
  answer: IncomingHttpHeaders,
  request: IncomingMessage,
  instance: RunningTestInstance,
  appPort: number,
  upgraded: boolean,
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(answer)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(name) && !(upgraded && (name === "connection" || name === "upgrade"))) {
      continue;
    }
    headers[name] = value;
  }
  const setCookies = answer["set-cookie"];
  if (setCookies !== undefined) {
    headers["set-cookie"] = setCookies.map((each) => browserSetCookie(each, instance.id));
  }
  const location = answer.location;
  if (location !== undefined) {
    const own = [`http://localhost:${appPort}`, `http://127.0.0.1:${instance.hostPort}`];
    const at = own.find((origin) => location === origin || location.startsWith(`${origin}/`));
    if (at !== undefined && request.headers.host !== undefined) {
      headers.location = `http://${request.headers.host}${location.slice(at.length)}`;
    }
  }
  return headers;
}

function sendPage(response: ServerResponse, page: ProxyPage): void {
  response.writeHead(page.status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  response.end(page.html);
}

function rawHead(status: number, message: string, headers: OutgoingHttpHeaders): string {
  const lines = [`HTTP/1.1 ${status} ${message}`];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    for (const each of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${each}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

function endRaw(
  socket: Duplex,
  status: number,
  message: string,
  contentType: string,
  body: string,
): void {
  const length = Buffer.byteLength(body);
  socket.end(
    rawHead(status, message, {
      "content-type": contentType,
      "content-length": length,
      connection: "close",
    }) + body,
  );
}
