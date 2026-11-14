import type { PageAddress } from "./page-address.js";
import type { WayUnavailable } from "./sign-in-way.js";

/**
 * The relying party a passkey is added and checked for (spec §2.10): its id, a name the browser
 * keeps the passkey under, and the origin the page must be on.
 */
export interface RelyingParty {
  readonly rpId: string;
  readonly origin: string;
}

export type RelyingPartyAt =
  { readonly relyingParty: RelyingParty } | { readonly unavailable: WayUnavailable };

/**
 * The relying party for a page at this address, or why passkeys don't work there. Passkeys need a
 * secure page and a name, not an IP: `localhost`, which browsers treat as secure, or the public
 * address over HTTPS. Both are built from what the Host check accepted or from the public address
 * itself, never from the request's Origin alone.
 */
export function relyingPartyAt(page: PageAddress): RelyingPartyAt {
  switch (page.kind) {
    case "localhost":
      return { relyingParty: { rpId: "localhost", origin: `http://${page.host}` } };
    case "loopback-ip":
      return { unavailable: { reason: "ip-address", elsewhere: localhostAt(page.host) } };
    case "local-network-ip":
      return needsHttpsDomain(page.publicAddress);
    case "public":
      return publicRelyingParty(page);
  }
}

/**
 * Where a passkey added for `rpId` works, told against the page's address: here; at The Office's
 * other address, with the public address to open when it is that one; or at an address that is
 * no longer The Office's, such as a public address since changed.
 */
export type PasskeyAt =
  | { readonly at: "this-address" }
  | { readonly at: "other-address"; readonly otherAddress?: string }
  | { readonly at: "old-address" };

export function passkeyAt(rpId: string, page: PageAddress): PasskeyAt {
  const here = relyingPartyAt(page);
  if ("relyingParty" in here && here.relyingParty.rpId === rpId) return { at: "this-address" };
  if (rpId === "localhost") return { at: "other-address" };
  const publicParty = publicRelyingParty({ ...page, kind: "public", secure: true });
  if ("relyingParty" in publicParty && publicParty.relyingParty.rpId === rpId) {
    return { at: "other-address", otherAddress: publicParty.relyingParty.origin };
  }
  return { at: "old-address" };
}

function publicRelyingParty({ secure, publicAddress }: PageAddress): RelyingPartyAt {
  if (publicAddress === undefined) return needsHttpsDomain(undefined);
  const { hostname, origin } = new URL(publicAddress);
  if (!secure || isIpAddress(hostname)) return needsHttpsDomain(publicAddress);
  return { relyingParty: { rpId: hostname, origin } };
}

/** Passkeys don't work here; they do at the public address when it is a domain name. */
function needsHttpsDomain(publicAddress: string | undefined): RelyingPartyAt {
  const domain =
    publicAddress !== undefined && !isIpAddress(new URL(publicAddress).hostname)
      ? new URL(publicAddress).origin
      : undefined;
  return {
    unavailable: {
      reason: "needs-https-domain",
      ...(domain !== undefined && { elsewhere: domain }),
    },
  };
}

/** The same port at `localhost`: `127.0.0.1:4310` is `http://localhost:4310`. */
function localhostAt(host: string): string {
  const { port } = new URL(`http://${host}`);
  return port === "" ? "http://localhost" : `http://localhost:${port}`;
}

/** An IPv4 address, or an IPv6 one, which a URL's hostname keeps in brackets. */
function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}
