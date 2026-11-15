import { isIP } from "node:net";
import type { OfficeConfig } from "./office-config.js";

const ANY_ADDRESS = new Set(["0.0.0.0", "::"]);
const LOOPBACK = /^(127\.|::1$)/;

/**
 * Where a person opens The Office, as the setup token is printed with it: the public address when
 * there is one, else `localhost` at the port for a loopback or every-address listen, else the
 * address it listens on.
 */
export function addressToOpen({
  host,
  port,
  publicAddress,
}: Pick<OfficeConfig, "host" | "port" | "publicAddress">): string {
  if (publicAddress !== undefined) return publicAddress;
  if (ANY_ADDRESS.has(host) || LOOPBACK.test(host)) return `http://localhost:${port}`;
  return isIP(host) === 6 ? `http://[${host}]:${port}` : `http://${host}:${port}`;
}
