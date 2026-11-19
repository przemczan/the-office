import { createHash } from "node:crypto";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { IdentityProviderFailed } from "../../ports/identity-provider.js";
import { InMemoryOpenIdConnectProviderRepository } from "../../ports/openid-connect-provider-repository.fixtures.js";
import { OpenIdConnectIdentityProvider } from "./openid-connect-identity-provider.js";

const NOW = new Date("2026-11-14T09:00:00.000Z");
const ISSUER = "https://login.example.com";
const CLIENT_ID = "office-client-id";
const CLIENT_SECRET = "the-client-secret";
const ACCESS_TOKEN = "the-access-token";
const REDIRECT_URI = "http://localhost:4310/api/sign-in/openid-connect/callback";
const CODE_VERIFIER = "the-code-verifier-of-at-least-forty-three-characters-long";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/oauth/v2/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/oauth/v2/token`;

let providers: InMemoryOpenIdConnectProviderRepository;
let provider: OpenIdConnectIdentityProvider;
let tokenRequests: Request[];
let tokenAnswer: () => Response;
let warnings: unknown[][];

beforeEach(() => {
  const schedule = new ManualSchedule();
  schedule.setTime(NOW);
  providers = new InMemoryOpenIdConnectProviderRepository({
    name: "Zitadel",
    issuer: ISSUER,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    authorizationEndpoint: AUTHORIZATION_ENDPOINT,
    tokenEndpoint: TOKEN_ENDPOINT,
    savedAt: NOW,
  });
  provider = new OpenIdConnectIdentityProvider(providers, schedule);
  tokenRequests = [];
  tokenAnswer = () => tokensAnswer(idTokenOf({}));
  vi.stubGlobal(
    "fetch",
    vi.fn((request: Request) => {
      tokenRequests.push(request);
      return Promise.resolve(tokenAnswer());
    }),
  );
  warnings = [];
  vi.spyOn(Logger.prototype, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A JWT part: JSON, base64url-encoded. */
function part(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** An ID token as the provider's token endpoint signs it; its signature isn't checked, so any will do. */
function idTokenOf(claims: Readonly<Record<string, unknown>>): string {
  return [
    part({ alg: "RS256", typ: "JWT" }),
    part({
      iss: ISSUER,
      aud: [CLIENT_ID],
      sub: "sub-of-ada",
      email: "ada@example.com",
      exp: NOW.getTime() / 1000 + 3600,
      iat: NOW.getTime() / 1000,
      ...claims,
    }),
    Buffer.from("signature").toString("base64url"),
  ].join(".");
}

function tokensAnswer(idToken: string): Response {
  return Response.json({
    access_token: ACCESS_TOKEN,
    id_token: idToken,
    token_type: "Bearer",
    expires_in: 3599,
  });
}

function identityOf(returned: { code?: string; error?: string } = { code: "the-code" }) {
  return provider.identityOf({
    code: returned.code,
    error: returned.error,
    codeVerifier: CODE_VERIFIER,
    redirectUri: REDIRECT_URI,
  });
}

describe("OpenIdConnectIdentityProvider", () => {
  it("sends the browser to the saved authorization endpoint with the client id, redirect URI, an S256 challenge, and openid, email and profile", async () => {
    const url = new URL(
      await provider.authorizeUrl({
        state: "the-state",
        codeVerifier: CODE_VERIFIER,
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(url.origin + url.pathname).toBe(AUTHORIZATION_ENDPOINT);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: "the-state",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(CODE_VERIFIER).digest("base64url"),
      scope: "openid email profile",
    });
    expect(url.href).not.toContain(CLIENT_SECRET);
  });

  it("takes the ID token's sub as the identity and its email as the name, sending the code, verifier and redirect URI to the token endpoint", async () => {
    const answer = await identityOf();

    expect(answer).toEqual({ subject: "sub-of-ada", name: "ada@example.com" });
    const [request] = tokenRequests;
    expect(request?.url).toBe(TOKEN_ENDPOINT);
    const body = new URLSearchParams(await request?.text());
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "authorization_code",
      code: "the-code",
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    });
    expect(request?.headers.get("authorization")).toBe(
      `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
    );
  });

  it("names the person by the email, else the preferred user name, else the sub, and takes a single audience", async () => {
    tokenAnswer = () => tokensAnswer(idTokenOf({ email: undefined, aud: CLIENT_ID }));
    await expect(identityOf()).resolves.toEqual({ subject: "sub-of-ada", name: "sub-of-ada" });

    tokenAnswer = () =>
      tokensAnswer(idTokenOf({ email: undefined, preferred_username: "ada.lovelace" }));
    await expect(identityOf()).resolves.toEqual({ subject: "sub-of-ada", name: "ada.lovelace" });

    tokenAnswer = () => tokensAnswer(idTokenOf({ email: "" }));
    await expect(identityOf()).resolves.toEqual({ subject: "sub-of-ada", name: "sub-of-ada" });
  });

  it("accepts an audience list holding the client id among others", async () => {
    tokenAnswer = () => tokensAnswer(idTokenOf({ aud: ["another", CLIENT_ID] }));

    await expect(identityOf()).resolves.toEqual(expect.objectContaining({ subject: "sub-of-ada" }));
  });

  it.each([
    ["another issuer", { iss: "https://evil.example.com" }],
    ["another client's audience", { aud: ["another-client"] }],
    ["an expired token", { exp: NOW.getTime() / 1000 - 1 }],
    ["no expiry", { exp: undefined }],
    ["no sub", { sub: undefined }],
    ["an empty sub", { sub: "" }],
  ])("refuses an ID token with %s, with a readable reason", async (_, claims) => {
    tokenAnswer = () => tokensAnswer(idTokenOf(claims));

    const failure = await identityOf().catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(IdentityProviderFailed);
    expect((failure as IdentityProviderFailed).reason).toContain(
      "Zitadel's answer wasn't for this Office's client",
    );
  });

  it("refuses an answer without an ID token", async () => {
    tokenAnswer = () => Response.json({ access_token: ACCESS_TOKEN, token_type: "Bearer" });

    await expect(identityOf()).rejects.toThrow("Zitadel's answer had no ID token");
  });

  it.each([
    ["invalid_client", 401, "doesn't accept the client ID or secret"],
    ["invalid_grant", 400, "no longer accepts this sign-in"],
    ["redirect_uri_mismatch", 400, `lists ${REDIRECT_URI} as a redirect URI`],
    ["invalid_request", 400, `lists ${REDIRECT_URI} as a redirect URI`],
    ["temporarily_unavailable", 400, "refused (temporarily_unavailable)"],
  ])("words the token endpoint's %s", async (error, status, reason) => {
    tokenAnswer = () => Response.json({ error }, { status });

    await expect(identityOf()).rejects.toThrow(reason);
  });

  it("words a cancel at the provider, and asks nothing of it without a code", async () => {
    await expect(identityOf({ error: "access_denied" })).rejects.toThrow(
      "You cancelled at Zitadel",
    );
    await expect(identityOf({})).rejects.toThrow("without a code");
    expect(tokenRequests).toEqual([]);
  });

  it("says the provider couldn't be reached when the request fails, or answers something unexpected", async () => {
    tokenAnswer = () => {
      throw new TypeError("fetch failed");
    };
    await expect(identityOf()).rejects.toThrow("Zitadel couldn't be reached");

    tokenAnswer = () => new Response("<html>", { status: 500 });
    await expect(identityOf()).rejects.toThrow("Zitadel answered something unexpected");
  });

  it("logs neither the client secret, the code nor any token, whatever happens", async () => {
    await identityOf();
    for (const answer of [
      () => tokensAnswer(idTokenOf({ aud: ["another"] })),
      () => Response.json({ error: "invalid_grant" }, { status: 400 }),
      () => new Response("<html>", { status: 500 }),
    ]) {
      tokenAnswer = answer;
      await identityOf().catch(() => undefined);
    }

    expect(warnings.length).toBeGreaterThan(0);
    const logged = JSON.stringify(warnings);
    for (const secret of [CLIENT_SECRET, ACCESS_TOKEN, "the-code", CODE_VERIFIER, "eyJ"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("is named as saved, works at every address, and is available only while a provider is saved", async () => {
    const at = (kind: "localhost" | "loopback-ip" | "local-network-ip" | "public", host: string) =>
      provider.unavailableAt({ kind, host, secure: kind === "public", publicAddress: ISSUER });

    expect(await provider.displayName()).toBe("Zitadel");
    expect(await provider.isAvailable()).toBe(true);
    for (const [kind, host] of [
      ["localhost", "localhost:4310"],
      ["loopback-ip", "127.0.0.1:4310"],
      ["local-network-ip", "192.168.1.20:4310"],
      ["public", "office.example.com"],
    ] as const) {
      expect(at(kind, host)).toBeUndefined();
    }

    await providers.remove(NOW);
    expect(await provider.isAvailable()).toBe(false);
    expect(await provider.displayName()).toBe("OpenID Connect");
    await expect(identityOf()).rejects.toThrow("isn't set up");
  });
});
