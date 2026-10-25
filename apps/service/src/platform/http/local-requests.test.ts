import { describe, expect, it } from "vitest";
import { localRequestRefusal } from "./local-requests.js";

const localPort = 4310;
const NOT_ADDRESSED_LOCALLY =
  "The Office answers only requests addressed to localhost or 127.0.0.1.";
const NOT_OFFICE_PAGE = "The Office answers only its own pages.";

describe("localRequestRefusal", () => {
  it.each(["localhost:4310", "127.0.0.1:4310", "LOCALHOST:4310"])(
    "lets a request addressed to %s through",
    (host) => {
      expect(localRequestRefusal({ host, origin: undefined, localPort })).toBeUndefined();
    },
  );

  it.each(["http://localhost:4310", "http://127.0.0.1:4310"])(
    "lets a request from The Office's page at %s through",
    (origin) => {
      expect(localRequestRefusal({ host: "localhost:4310", origin, localPort })).toBeUndefined();
    },
  );

  it.each([
    ["no Host", undefined],
    ["a rebound name", "evil.example:4310"],
    ["another port", "localhost:5173"],
    ["no port", "localhost"],
    ["the LAN address", "10.1.1.101:4310"],
    ["IPv6 loopback", "[::1]:4310"],
    ["a trailing path", "localhost:4310/api"],
    ["a user part", "office@localhost:4310"],
  ])("refuses a request with %s in Host", (_, host) => {
    expect(localRequestRefusal({ host, origin: undefined, localPort })).toBe(NOT_ADDRESSED_LOCALLY);
  });

  it.each([
    ["another site", "https://evil.example"],
    ["another local port", "http://localhost:5173"],
    ["HTTPS", "https://localhost:4310"],
    ["an opaque origin", "null"],
    ["a trailing slash", "http://localhost:4310/"],
  ])("refuses a request from %s", (_, origin) => {
    expect(localRequestRefusal({ host: "localhost:4310", origin, localPort })).toBe(
      NOT_OFFICE_PAGE,
    );
  });

  it("leaves the port out on HTTP's default port, as browsers do", () => {
    expect(
      localRequestRefusal({ host: "localhost", origin: "http://localhost", localPort: 80 }),
    ).toBeUndefined();
    expect(localRequestRefusal({ host: "localhost:80", origin: undefined, localPort: 80 })).toBe(
      NOT_ADDRESSED_LOCALLY,
    );
  });
});
