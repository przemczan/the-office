import type { IncomingMessage } from "node:http";
import {
  addressingOf,
  localRequestRefusal,
  requestAddressOf,
  type RequestAddress,
} from "./local-requests.js";

/**
 * The addresses The Office answers at (spec §5.1): `localhost`, `127.0.0.1` and the IP address a
 * request arrived at, at its port, and the public address when it has one. Bound by
 * `RequestAccessModule`, for HTTP and the WebSocket alike.
 */
export class OfficeAddresses {
  /** The public address as an origin, such as `https://office.example.com`. */
  constructor(readonly publicAddress: string | undefined) {}

  /** The public address's hostname, such as `office.example.com`; undefined when it has none. */
  get publicHostname(): string | undefined {
    return this.publicAddress === undefined ? undefined : new URL(this.publicAddress).hostname;
  }

  /** Why the request is refused before any sign-in is looked at, or undefined when it may proceed. */
  refusal(request: IncomingMessage): string | undefined {
    return localRequestRefusal(addressingOf(request), this.publicAddress);
  }

  /** The kind of address a request this let through was addressed to, and whether it is HTTPS. */
  addressOf(request: IncomingMessage): RequestAddress {
    return requestAddressOf(addressingOf(request), this.publicAddress);
  }
}
