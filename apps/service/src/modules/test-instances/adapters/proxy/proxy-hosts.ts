import type { InterfaceAddress } from "../../ports/workstation-addresses.js";

const ANY_ADDRESS = new Set(["0.0.0.0", "::"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const LOCALHOST = "localhost";
const HTTP_DEFAULT_PORT = 80;

/**
 * Whether a request at a Proxy port is addressed to it (spec §5.1): `localhost`, `127.0.0.1`,
 * `OFFICE_HOST` unless it is every address, the IP address the request arrived at (so, with
 * `OFFICE_HOST` on every address, this computer's own address on the network), or the public
 * address's name, each at the port. A rebound DNS name is never one of them.
 */
export function addressedToProxy(
  host: string | undefined,
  {
    officeHost,
    publicHostname,
    localAddress,
    port,
  }: { officeHost: string; publicHostname?: string; localAddress: string; port: number },
): boolean {
  if (host === undefined) return false;
  const hostnames = [LOCALHOST, "127.0.0.1", ...ownAddress(localAddress)];
  if (!ANY_ADDRESS.has(officeHost)) hostnames.push(bracketed(officeHost.toLowerCase()));
  if (publicHostname !== undefined) hostnames.push(publicHostname.toLowerCase());
  return hostnames
    .map((hostname) => (port === HTTP_DEFAULT_PORT ? hostname : `${hostname}:${port}`))
    .includes(host.toLowerCase());
}

/**
 * The hostnames a Proxy port is reached at (spec §2.12, "Reaching a Hosted instance"), the page's
 * own first: then `localhost` when the proxy listens on loopback or every address, each of the
 * workstation's network addresses when it listens on every address (IPv6 ones only on `::`, and
 * never a link-local one, which a browser can't open), or `OFFICE_HOST` itself when it is one
 * address. Each is one `addressedToProxy` lets through. With no page (an Agent's call), the
 * workstation's network addresses come before `localhost`, which only this computer reaches.
 */
export function reachableHostnames({
  officeHost,
  pageHostname,
  interfaces,
}: {
  officeHost: string;
  /** The hostname the page asking was opened at, which The Office's own Host check let through. */
  pageHostname: string | undefined;
  interfaces: readonly InterfaceAddress[];
}): string[] {
  const listening = officeHost.toLowerCase();
  const hostnames = pageHostname === undefined ? [] : [pageHostname.toLowerCase()];
  if (ANY_ADDRESS.has(listening)) {
    if (pageHostname !== undefined) hostnames.push(LOCALHOST);
    for (const { address, family, internal } of interfaces) {
      if (internal) continue;
      if (family === "IPv4") hostnames.push(address);
      else if (listening === "::" && !isLinkLocal(address)) hostnames.push(bracketed(address));
    }
    if (pageHostname === undefined) hostnames.push(LOCALHOST);
  } else if (LOOPBACK_HOSTS.has(listening)) {
    hostnames.push(LOCALHOST);
  } else {
    hostnames.push(bracketed(listening));
  }
  return [...new Set(hostnames)];
}

/** The hostname a Host header names, without its port; an IPv6 address keeps its brackets. */
export function hostnameOf(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? host);
}

// An IPv4 address a dual-stack socket reports as ::ffff:a.b.c.d is a.b.c.d to a browser.
function ownAddress(localAddress: string): string[] {
  const ipv4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(localAddress);
  if (ipv4?.[1] !== undefined) return [ipv4[1]];
  return localAddress.includes(":") ? [`[${localAddress.toLowerCase()}]`] : [];
}

function bracketed(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname.toLowerCase()}]`
    : hostname;
}

function isLinkLocal(ipv6: string): boolean {
  return /^fe[89ab]/i.test(ipv6);
}
