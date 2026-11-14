import { describe, expect, it } from "vitest";
import type { PageAddress } from "./page-address.js";
import { passkeyAt, relyingPartyAt } from "./relying-party.js";

const PUBLIC_ADDRESS = "https://office.example.com";

function page(overrides: Partial<PageAddress>): PageAddress {
  return {
    kind: "localhost",
    host: "localhost:4310",
    secure: false,
    publicAddress: PUBLIC_ADDRESS,
    ...overrides,
  };
}

describe("relyingPartyAt", () => {
  it("is localhost at the port the Host named", () => {
    expect(relyingPartyAt(page({}))).toEqual({
      relyingParty: { rpId: "localhost", origin: "http://localhost:4310" },
    });
    expect(relyingPartyAt(page({ host: "localhost" }))).toEqual({
      relyingParty: { rpId: "localhost", origin: "http://localhost" },
    });
  });

  it("is the public address's name and origin over HTTPS, never the Host's port", () => {
    expect(
      relyingPartyAt(page({ kind: "public", host: "office.example.com:8443", secure: true })),
    ).toEqual({ relyingParty: { rpId: "office.example.com", origin: PUBLIC_ADDRESS } });
  });

  it("isn't a loopback IP, which links to localhost at the same port", () => {
    expect(relyingPartyAt(page({ kind: "loopback-ip", host: "127.0.0.1:4310" }))).toEqual({
      unavailable: { reason: "ip-address", elsewhere: "http://localhost:4310" },
    });
    expect(relyingPartyAt(page({ kind: "loopback-ip", host: "[::1]:4310" }))).toEqual({
      unavailable: { reason: "ip-address", elsewhere: "http://localhost:4310" },
    });
  });

  it("isn't a local network IP, which links to the public address when it is a domain", () => {
    expect(relyingPartyAt(page({ kind: "local-network-ip", host: "192.168.1.20:4310" }))).toEqual({
      unavailable: { reason: "needs-https-domain", elsewhere: PUBLIC_ADDRESS },
    });
    expect(
      relyingPartyAt(
        page({ kind: "local-network-ip", host: "192.168.1.20:4310", publicAddress: undefined }),
      ),
    ).toEqual({ unavailable: { reason: "needs-https-domain" } });
  });

  it("isn't the public address over plain HTTP, nor one that is an IP", () => {
    expect(relyingPartyAt(page({ kind: "public", host: "office.example.com" }))).toEqual({
      unavailable: { reason: "needs-https-domain", elsewhere: PUBLIC_ADDRESS },
    });
    expect(
      relyingPartyAt(
        page({
          kind: "public",
          host: "203.0.113.7",
          secure: true,
          publicAddress: "https://203.0.113.7",
        }),
      ),
    ).toEqual({ unavailable: { reason: "needs-https-domain" } });
  });
});

describe("passkeyAt", () => {
  const atLocalhost = page({});
  const atPublic = page({ kind: "public", host: "office.example.com", secure: true });

  it("is this address for the page's own relying party", () => {
    expect(passkeyAt("localhost", atLocalhost)).toEqual({ at: "this-address" });
    expect(passkeyAt("office.example.com", atPublic)).toEqual({ at: "this-address" });
  });

  it("is the other address for The Office's other relying party, linking the public one", () => {
    expect(passkeyAt("office.example.com", atLocalhost)).toEqual({
      at: "other-address",
      otherAddress: PUBLIC_ADDRESS,
    });
    expect(passkeyAt("localhost", atPublic)).toEqual({ at: "other-address" });
  });

  it("is an old address for a name that is no longer The Office's", () => {
    expect(passkeyAt("old.example.com", atLocalhost)).toEqual({ at: "old-address" });
    expect(passkeyAt("office.example.com", page({ publicAddress: undefined }))).toEqual({
      at: "old-address",
    });
  });
});
