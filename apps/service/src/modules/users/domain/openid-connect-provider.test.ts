import { describe, expect, it } from "vitest";
import {
  isAnotherIssuer,
  isSecureEnough,
  openIdConnectEntryOf,
  openIdConnectProviderOf,
  type OpenIdConnectProvider,
  type OpenIdConnectProviderEntry,
} from "./openid-connect-provider.js";

const NOW = new Date("2026-11-14T09:00:00.000Z");
const ENTRY: OpenIdConnectProviderEntry = {
  name: "Zitadel",
  issuer: "https://login.example.com",
  clientId: "id",
  clientSecret: "secret",
};
const SAVED: OpenIdConnectProvider = {
  ...ENTRY,
  authorizationEndpoint: "https://login.example.com/authorize",
  tokenEndpoint: "https://login.example.com/token",
  savedAt: NOW,
};

describe("isSecureEnough", () => {
  it.each([
    ["https://login.example.com", true],
    ["http://localhost:8080", true],
    ["http://127.0.0.1:8080", true],
    ["http://[::1]:8080", true],
    ["http://example.com", false],
    ["http://localhost.example.com", false],
    ["ftp://localhost", false],
    ["not an address", false],
  ])("%s is %s", (address, secure) => {
    expect(isSecureEnough(address)).toBe(secure);
  });
});

describe("openIdConnectEntryOf", () => {
  it("trims every field and the issuer's trailing slashes", () => {
    expect(
      openIdConnectEntryOf(
        {
          name: " Zitadel ",
          issuer: " https://login.example.com// ",
          clientId: " id ",
          clientSecret: " s ",
        },
        undefined,
      ),
    ).toEqual({
      checked: {
        name: "Zitadel",
        issuer: "https://login.example.com",
        clientId: "id",
        clientSecret: "s",
      },
    });
  });

  it("keeps the saved secret for an empty one, and refuses none at all", () => {
    expect(
      openIdConnectEntryOf({ ...ENTRY, clientSecret: " " }, { ...SAVED, clientSecret: "kept" }),
    ).toEqual({
      checked: { ...ENTRY, clientSecret: "kept" },
    });
    expect(openIdConnectEntryOf({ ...ENTRY, clientSecret: "" }, undefined)).toEqual({
      problems: ["Enter the client secret."],
    });
  });

  it.each([
    ["an issuer with a query", "https://login.example.com?x=1", "can't have a query"],
    ["an issuer with a user name", "https://ada@login.example.com", "can't have a query"],
    ["an issuer that isn't an address", "login", "isn't a web address"],
    ["an issuer of plain HTTP", "http://login.example.com", "must start with https://"],
  ])("refuses %s", (_, issuer, problem) => {
    const checked = openIdConnectEntryOf({ ...ENTRY, issuer }, undefined);

    expect(checked).toEqual({ problems: [expect.stringContaining(problem)] });
  });

  it("refuses a client ID or secret over 512 characters", () => {
    expect(openIdConnectEntryOf({ ...ENTRY, clientId: "x".repeat(513) }, undefined)).toEqual({
      problems: [expect.stringContaining("at most 512")],
    });
  });
});

describe("openIdConnectProviderOf", () => {
  const discovered = {
    issuer: ENTRY.issuer,
    authorizationEndpoint: SAVED.authorizationEndpoint,
    tokenEndpoint: SAVED.tokenEndpoint,
  };

  it("makes the provider from the entry and the document", () => {
    expect(openIdConnectProviderOf(ENTRY, discovered, NOW)).toEqual({ checked: SAVED });
  });

  it("accepts a document naming the issuer with a trailing slash, and refuses another issuer or an insecure endpoint", () => {
    expect(
      openIdConnectProviderOf(ENTRY, { ...discovered, issuer: `${ENTRY.issuer}/` }, NOW),
    ).toHaveProperty("checked");
    expect(
      openIdConnectProviderOf(ENTRY, { ...discovered, issuer: "https://other.example.com" }, NOW),
    ).toHaveProperty("problems");
    expect(
      openIdConnectProviderOf(
        ENTRY,
        { ...discovered, tokenEndpoint: "http://login.example.com/token" },
        NOW,
      ),
    ).toHaveProperty("problems");
  });
});

describe("isAnotherIssuer", () => {
  it("is true only when a provider was saved last at another issuer", () => {
    expect(isAnotherIssuer(undefined, SAVED)).toBe(false);
    expect(isAnotherIssuer(SAVED.issuer, { ...SAVED, name: "Other", clientId: "x" })).toBe(false);
    expect(isAnotherIssuer(SAVED.issuer, { ...SAVED, issuer: "https://other.example.com" })).toBe(
      true,
    );
  });
});
