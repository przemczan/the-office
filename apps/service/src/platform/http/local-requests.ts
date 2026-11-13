import type { IncomingMessage } from "node:http";

const LOCALHOST = "localhost";
const LOOPBACK_IP = "127.0.0.1";
const HTTP_DEFAULT_PORT = 80;

/** The parts of a request that say who addressed it, and the address and port it arrived on. */
export interface RequestAddressing {
  readonly host: string | undefined;
  readonly origin: string | undefined;
  /** `X-Forwarded-Proto`, which the reverse proxy in front of the public address sets. */
  readonly forwardedProto: string | undefined;
  readonly localAddress: string;
  readonly localPort: number;
}

/**
 * The kind of address a page was opened at (spec §2.10): the name `localhost`, a loopback IP, an
 * IP on the local network over plain HTTP, or the public address behind the user's reverse proxy.
 */
export type AddressKind = "localhost" | "loopback-ip" | "local-network-ip" | "public";

export interface RequestAddress {
  readonly kind: AddressKind;
  /** Whether the browser reached it over HTTPS: only the public address, through its proxy. */
  readonly secure: boolean;
}

/**
 * Why the request is refused, or undefined when it may proceed (spec §5.1): it must be addressed to
 * localhost, 127.0.0.1 or the IP address it arrived at, at the port it arrived on, which defeats
 * DNS rebinding (a rebound name is never an IP address), or to the public address's name, and an
 * Origin, when sent, must be one of those addresses' own, since browsers let any page open a
 * WebSocket to localhost.
 */
export function localRequestRefusal(
  addressing: RequestAddressing,
  publicAddress: string | undefined,
): string | undefined {
  const host = addressing.host?.toLowerCase();
  const localHosts = localHostsAt(addressing.localAddress, addressing.localPort);
  const publicHost = publicAddress === undefined ? undefined : new URL(publicAddress).host;
  if (host === undefined || !(localHosts.includes(host) || host === publicHost)) {
    return "The Office answers only requests addressed to localhost, its own IP address or its public address.";
  }
  const { origin } = addressing;
  if (
    origin !== undefined &&
    origin !== publicAddress &&
    !localHosts.some((localHost) => origin === `http://${localHost}`)
  ) {
    return "The Office answers only its own pages.";
  }
  return undefined;
}

/** The kind of address a request that localRequestRefusal let through was addressed to. */
export function requestAddressOf(
  addressing: RequestAddressing,
  publicAddress: string | undefined,
): RequestAddress {
  const hostname = hostnameOf(addressing.host?.toLowerCase() ?? "");
  if (publicAddress !== undefined && hostname === new URL(publicAddress).hostname) {
    return { kind: "public", secure: addressing.forwardedProto?.toLowerCase() === "https" };
  }
  if (hostname === LOCALHOST) return { kind: "localhost", secure: false };
  return { kind: isLoopbackIp(hostname) ? "loopback-ip" : "local-network-ip", secure: false };
}

export function addressingOf(request: IncomingMessage): RequestAddressing {
  const forwardedProto = request.headers["x-forwarded-proto"];
  return {
    host: request.headers.host,
    origin: request.headers.origin,
    forwardedProto: Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto,
    localAddress: request.socket.localAddress ?? "",
    localPort: request.socket.localPort ?? Number.NaN,
  };
}

// Host and Origin as browsers write them: the port is left out when it is HTTP's default, and an
// IPv6 address is in brackets.
function localHostsAt(localAddress: string, port: number): string[] {
  return [LOCALHOST, LOOPBACK_IP, ...ownAddress(localAddress)].map((hostname) =>
    port === HTTP_DEFAULT_PORT ? hostname : `${hostname}:${port}`,
  );
}

// An IPv4 address a dual-stack socket reports as ::ffff:a.b.c.d is a.b.c.d to a browser.
function ownAddress(localAddress: string): string[] {
  const ipv4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(localAddress);
  if (ipv4?.[1] !== undefined) return [ipv4[1]];
  return localAddress.includes(":") ? [`[${localAddress.toLowerCase()}]`] : [];
}

/** A Host header without its port: `[::1]:4310` is `[::1]`, `localhost:4310` is `localhost`. */
function hostnameOf(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? host);
}

function isLoopbackIp(hostname: string): boolean {
  return /^127(?:\.\d{1,3}){3}$/.test(hostname) || hostname === "[::1]";
}
