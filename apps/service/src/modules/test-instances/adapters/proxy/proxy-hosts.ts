const ANY_ADDRESS = new Set(["0.0.0.0", "::"]);
const HTTP_DEFAULT_PORT = 80;

/**
 * Whether a request at a Proxy port is addressed to it (spec §5.1): `localhost`, `127.0.0.1`,
 * `OFFICE_HOST` unless it is every address, or the IP address the request arrived at (so, with
 * `OFFICE_HOST` on every address, this computer's own address on the network), each at the port.
 * A rebound DNS name is never one of them.
 */
export function addressedToProxy(
  host: string | undefined,
  { officeHost, localAddress, port }: { officeHost: string; localAddress: string; port: number },
): boolean {
  if (host === undefined) return false;
  const hostnames = ["localhost", "127.0.0.1", ...ownAddress(localAddress)];
  if (!ANY_ADDRESS.has(officeHost)) hostnames.push(bracketed(officeHost.toLowerCase()));
  return hostnames
    .map((hostname) => (port === HTTP_DEFAULT_PORT ? hostname : `${hostname}:${port}`))
    .includes(host.toLowerCase());
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
  return hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
}
