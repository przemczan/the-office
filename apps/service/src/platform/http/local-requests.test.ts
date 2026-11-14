import { describe, expect, it } from "vitest";
import { localRequestRefusal, requestAddressOf, type RequestAddressing } from "./local-requests.js";

const localAddress = "127.0.0.1";
const localPort = 4310;
const PUBLIC_ADDRESS = "https://office.example.com";
const NOT_ADDRESSED_LOCALLY =
  "The Office answers only requests addressed to localhost, its own IP address or its public address.";
const NOT_OFFICE_PAGE = "The Office answers only its own pages.";

function addressing(fields: Partial<RequestAddressing>): RequestAddressing {
  return {
    host: undefined,
    origin: undefined,
    forwardedProto: undefined,
    localAddress,
    localPort,
    ...fields,
  };
}

function refusal(fields: Partial<RequestAddressing>, publicAddress?: string): string | undefined {
  return localRequestRefusal(addressing(fields), publicAddress);
}

describe("localRequestRefusal", () => {
  it.each(["localhost:4310", "127.0.0.1:4310", "LOCALHOST:4310"])(
    "lets a request addressed to %s through",
    (host) => {
      expect(refusal({ host })).toBeUndefined();
    },
  );

  it.each(["http://localhost:4310", "http://127.0.0.1:4310"])(
    "lets a request from The Office's page at %s through",
    (origin) => {
      expect(refusal({ host: "localhost:4310", origin })).toBeUndefined();
    },
  );

  it.each([
    ["no Host", undefined],
    ["a rebound name", "evil.example:4310"],
    ["another port", "localhost:5173"],
    ["no port", "localhost"],
    ["an address it did not arrive at", "10.1.1.101:4310"],
    ["IPv6 loopback", "[::1]:4310"],
    ["a trailing path", "localhost:4310/api"],
    ["a user part", "office@localhost:4310"],
  ])("refuses a request with %s in Host", (_, host) => {
    expect(refusal({ host })).toBe(NOT_ADDRESSED_LOCALLY);
  });

  it.each([
    ["another site", "https://evil.example"],
    ["another local port", "http://localhost:5173"],
    ["HTTPS", "https://localhost:4310"],
    ["an opaque origin", "null"],
    ["a trailing slash", "http://localhost:4310/"],
  ])("refuses a request from %s", (_, origin) => {
    expect(refusal({ host: "localhost:4310", origin })).toBe(NOT_OFFICE_PAGE);
  });

  it("leaves the port out on HTTP's default port, as browsers do", () => {
    expect(
      refusal({ host: "localhost", origin: "http://localhost", localPort: 80 }),
    ).toBeUndefined();
    expect(refusal({ host: "localhost:80", localPort: 80 })).toBe(NOT_ADDRESSED_LOCALLY);
  });

  describe("on the network", () => {
    it.each([
      ["an IPv4 address", "10.1.1.70", "10.1.1.70:4310"],
      ["an IPv4 address a dual-stack socket reports mapped", "::ffff:10.1.1.70", "10.1.1.70:4310"],
      ["an IPv6 address", "fd00::70", "[fd00::70]:4310"],
    ])("lets a request addressed to the %s it arrived at through", (_, address, host) => {
      expect(refusal({ host, origin: `http://${host}`, localAddress: address })).toBeUndefined();
    });

    it("still refuses a name, another address and another port", () => {
      const arrivedAt = { localAddress: "10.1.1.70" };

      expect(refusal({ host: "evil.example:4310", ...arrivedAt })).toBe(NOT_ADDRESSED_LOCALLY);
      expect(refusal({ host: "10.1.1.71:4310", ...arrivedAt })).toBe(NOT_ADDRESSED_LOCALLY);
      expect(refusal({ host: "10.1.1.70:5173", ...arrivedAt })).toBe(NOT_ADDRESSED_LOCALLY);
    });

    it("refuses a page from another site", () => {
      expect(
        refusal({
          host: "10.1.1.70:4310",
          origin: "http://evil.example",
          localAddress: "10.1.1.70",
        }),
      ).toBe(NOT_OFFICE_PAGE);
    });
  });

  describe("at the public address", () => {
    it("lets its name and its own https:// page through, whatever port the proxy reached", () => {
      expect(
        refusal(
          { host: "office.example.com", origin: PUBLIC_ADDRESS, localPort: 4310 },
          PUBLIC_ADDRESS,
        ),
      ).toBeUndefined();
      expect(
        refusal({ host: "localhost:4310", origin: PUBLIC_ADDRESS }, PUBLIC_ADDRESS),
      ).toBeUndefined();
    });

    it("still refuses other names and other pages", () => {
      expect(refusal({ host: "evil.example" }, PUBLIC_ADDRESS)).toBe(NOT_ADDRESSED_LOCALLY);
      expect(refusal({ host: "office.example.com:8443" }, PUBLIC_ADDRESS)).toBe(
        NOT_ADDRESSED_LOCALLY,
      );
      expect(
        refusal(
          { host: "office.example.com", origin: "http://office.example.com" },
          PUBLIC_ADDRESS,
        ),
      ).toBe(NOT_OFFICE_PAGE);
      expect(
        refusal({ host: "office.example.com", origin: "https://evil.example" }, PUBLIC_ADDRESS),
      ).toBe(NOT_OFFICE_PAGE);
    });

    it("refuses its name while The Office has no public address", () => {
      expect(refusal({ host: "office.example.com" })).toBe(NOT_ADDRESSED_LOCALLY);
    });
  });
});

describe("requestAddressOf", () => {
  it.each([
    ["localhost", "localhost:4310", "127.0.0.1", "localhost"],
    ["a loopback IP", "127.0.0.1:4310", "127.0.0.1", "loopback-ip"],
    ["IPv6 loopback", "[::1]:4310", "::1", "loopback-ip"],
    ["a local network IP", "10.1.1.70:4310", "10.1.1.70", "local-network-ip"],
    ["a local network IPv6", "[fd00::70]:4310", "fd00::70", "local-network-ip"],
  ] as const)("tells %s, over plain HTTP", (_, host, arrivedAt, kind) => {
    expect(requestAddressOf(addressing({ host, localAddress: arrivedAt }), PUBLIC_ADDRESS)).toEqual(
      { kind, secure: false },
    );
  });

  it("tells the public address, secure only when the proxy says it came over HTTPS", () => {
    expect(
      requestAddressOf(
        addressing({ host: "office.example.com", forwardedProto: "https" }),
        PUBLIC_ADDRESS,
      ),
    ).toEqual({ kind: "public", secure: true });
    expect(requestAddressOf(addressing({ host: "office.example.com" }), PUBLIC_ADDRESS)).toEqual({
      kind: "public",
      secure: false,
    });
  });

  it("takes X-Forwarded-Proto at any other address as nothing", () => {
    expect(
      requestAddressOf(
        addressing({ host: "localhost:4310", forwardedProto: "https" }),
        PUBLIC_ADDRESS,
      ),
    ).toEqual({ kind: "localhost", secure: false });
  });
});
