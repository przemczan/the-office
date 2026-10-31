import type { IncomingMessage, ServerResponse } from "node:http";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"] as const;
const HTTP_DEFAULT_PORT = 80;

/** The parts of a request that say who addressed it, and the address and port it arrived on. */
export interface RequestAddressing {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly localAddress: string;
  readonly localPort: number;
}

/**
 * Why the request is refused, or undefined when it may proceed (spec §5.1): it must be addressed to
 * localhost, 127.0.0.1 or the IP address it arrived at, at the port it arrived on, which defeats
 * DNS rebinding (a rebound name is never an IP address), and an Origin, when sent, must be The
 * Office's own, since browsers let any page open a WebSocket to localhost.
 */
export function localRequestRefusal({
  host,
  origin,
  localAddress,
  localPort,
}: RequestAddressing): string | undefined {
  const localHosts = localHostsAt(localAddress, localPort);
  if (host === undefined || !localHosts.includes(host.toLowerCase())) {
    return "The Office answers only requests addressed to localhost or to its own IP address.";
  }
  if (origin !== undefined && !localHosts.some((localHost) => origin === `http://${localHost}`)) {
    return "The Office answers only its own pages.";
  }
  return undefined;
}

/** Express middleware that answers 403 to every request localRequestRefusal refuses. */
export function refuseNonLocalRequests(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  const refusal = localRequestRefusal(addressingOf(request));
  if (refusal === undefined) {
    next();
    return;
  }
  response.statusCode = 403;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify({ statusCode: 403, message: refusal, error: "Forbidden" }));
}

export function addressingOf(request: IncomingMessage): RequestAddressing {
  return {
    host: request.headers.host,
    origin: request.headers.origin,
    localAddress: request.socket.localAddress ?? "",
    localPort: request.socket.localPort ?? Number.NaN,
  };
}

// Host and Origin as browsers write them: the port is left out when it is HTTP's default, and an
// IPv6 address is in brackets.
function localHostsAt(localAddress: string, port: number): string[] {
  return [...LOCAL_HOSTNAMES, ...ownAddress(localAddress)].map((hostname) =>
    port === HTTP_DEFAULT_PORT ? hostname : `${hostname}:${port}`,
  );
}

// An IPv4 address a dual-stack socket reports as ::ffff:a.b.c.d is a.b.c.d to a browser.
function ownAddress(localAddress: string): string[] {
  const ipv4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(localAddress);
  if (ipv4?.[1] !== undefined) return [ipv4[1]];
  return localAddress.includes(":") ? [`[${localAddress.toLowerCase()}]`] : [];
}
