/**
 * The kind of address a page was opened at (spec §2.10): the name `localhost`, a loopback IP, an
 * IP on the local network over plain HTTP, or the public address behind the user's reverse proxy.
 * The platform tells it; the domain keeps its own copy, as it takes nothing from the platform.
 */
export type AddressKind = "localhost" | "loopback-ip" | "local-network-ip" | "public";

export const ADDRESS_KINDS: readonly AddressKind[] = [
  "localhost",
  "loopback-ip",
  "local-network-ip",
  "public",
];
