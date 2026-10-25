import type { IncomingMessage, ServerResponse } from "node:http";

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"] as const;
const HTTP_DEFAULT_PORT = 80;

/** The parts of a request that say who addressed it, and the port it arrived on. */
export interface RequestAddressing {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  readonly localPort: number;
}

/**
 * Why the request is refused, or undefined when it may proceed (spec §5.1): it must be addressed to
 * localhost or 127.0.0.1 at the port it arrived on, which defeats DNS rebinding, and an Origin, when
 * sent, must be The Office's own, since browsers let any page open a WebSocket to localhost.
 */
export function localRequestRefusal({
  host,
  origin,
  localPort,
}: RequestAddressing): string | undefined {
  const localHosts = localHostsAt(localPort);
  if (host === undefined || !localHosts.includes(host.toLowerCase())) {
    return "The Office answers only requests addressed to localhost or 127.0.0.1.";
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
    localPort: request.socket.localPort ?? Number.NaN,
  };
}

// Host and Origin as browsers write them: the port is left out when it is HTTP's default.
function localHostsAt(port: number): string[] {
  return LOCAL_HOSTNAMES.map((hostname) =>
    port === HTTP_DEFAULT_PORT ? hostname : `${hostname}:${port}`,
  );
}
