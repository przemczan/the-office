import type { AddressKind } from "./address-kind.js";

/**
 * The address a page was opened at, as the platform's Host and Origin checks let it through, and
 * The Office's public address it was told against.
 */
export interface PageAddress {
  readonly kind: AddressKind;
  /** The Host header, lowercase, as the checks accepted it: `localhost:4310`, `127.0.0.1:4310`. */
  readonly host: string;
  /** Whether the browser reached it over HTTPS: only the public address, through its proxy. */
  readonly secure: boolean;
  /** The public address as an origin, such as `https://office.example.com`, when there is one. */
  readonly publicAddress: string | undefined;
}
