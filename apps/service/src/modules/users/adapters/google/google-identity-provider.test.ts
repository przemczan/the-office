import { createHash } from "node:crypto";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { IdentityProviderFailed } from "../../ports/identity-provider.js";
import { InMemoryGoogleClientRepository } from "../../ports/google-client-repository.fixtures.js";
import { GoogleIdentityProvider } from "./google-identity-provider.js";

const NOW = new Date("2026-11-14T09:00:00.000Z");
const CLIENT_ID = "1234-office.apps.googleusercontent.com";
const CLIENT_SECRET = "GOCSPX-the-client-secret";
const ACCESS_TOKEN = "ya29.the-access-token";
const REDIRECT_URI = "http://localhost:4310/api/sign-in/google/callback";
const CODE_VERIFIER = "the-code-verifier-of-at-least-forty-three-characters-long";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

let clients: InMemoryGoogleClientRepository;
let google: GoogleIdentityProvider;
let tokenRequests: Request[];
let tokenAnswer: () => Response;
let warnings: unknown[][];

beforeEach(() => {
  const schedule = new ManualSchedule();
  schedule.setTime(NOW);
  clients = new InMemoryGoogleClientRepository({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    savedAt: NOW,
  });
  google = new GoogleIdentityProvider(clients, schedule);
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

/** An ID token as Google's token endpoint signs it; its signature isn't checked, so any will do. */
function idTokenOf(claims: Readonly<Record<string, unknown>>): string {
  return [
    part({ alg: "RS256", typ: "JWT" }),
    part({
      iss: "https://accounts.google.com",
      aud: CLIENT_ID,
      sub: "110248495921238986420",
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
    scope: "openid https://www.googleapis.com/auth/userinfo.email",
  });
}

function identityOf(returned: { code?: string; error?: string } = { code: "the-code" }) {
  return google.identityOf({
    code: returned.code,
    error: returned.error,
    codeVerifier: CODE_VERIFIER,
    redirectUri: REDIRECT_URI,
  });
}

describe("GoogleIdentityProvider", () => {
  it("sends the browser to Google with the client id, redirect URI, an S256 challenge, openid and email, and no offline access", async () => {
    const url = new URL(
      await google.authorizeUrl({
        state: "the-state",
        codeVerifier: CODE_VERIFIER,
        redirectUri: REDIRECT_URI,
      }),
    );

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: "the-state",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(CODE_VERIFIER).digest("base64url"),
      scope: "openid email",
    });
    expect(url.href).not.toContain(CLIENT_SECRET);
  });

  it("takes the ID token's sub as the identity and its email as the name, sending the code, verifier and redirect URI", async () => {
    const answer = await identityOf();

    expect(answer).toEqual({ subject: "110248495921238986420", name: "ada@example.com" });
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

  it("accepts the issuer without its scheme, as Google may send it", async () => {
    tokenAnswer = () => tokensAnswer(idTokenOf({ iss: "accounts.google.com" }));

    await expect(identityOf()).resolves.toEqual(
      expect.objectContaining({ subject: "110248495921238986420" }),
    );
  });

  it.each([
    ["another client's audience", { aud: "another.apps.googleusercontent.com" }],
    ["another issuer", { iss: "https://accounts.example.com" }],
    ["an expired token", { exp: NOW.getTime() / 1000 - 1 }],
    ["no sub", { sub: undefined }],
  ])("refuses an ID token with %s", async (_, claims) => {
    tokenAnswer = () => tokensAnswer(idTokenOf(claims));

    await expect(identityOf()).rejects.toThrow(IdentityProviderFailed);
  });

  it("refuses an answer without an ID token", async () => {
    tokenAnswer = () => Response.json({ access_token: ACCESS_TOKEN, token_type: "Bearer" });

    await expect(identityOf()).rejects.toThrow("no ID token");
  });

  it("says which redirect URI to add on redirect_uri_mismatch", async () => {
    tokenAnswer = () => Response.json({ error: "redirect_uri_mismatch" }, { status: 400 });

    await expect(identityOf()).rejects.toThrow(`add ${REDIRECT_URI} to it`);
  });

  it("words Google's refusals and a cancel, and asks nothing of Google without a code", async () => {
    tokenAnswer = () => Response.json({ error: "invalid_client" }, { status: 401 });

    await expect(identityOf()).rejects.toThrow("Settings › Signing in");
    await expect(identityOf({ error: "access_denied" })).rejects.toThrow("You cancelled at Google");
    expect(tokenRequests).toHaveLength(1);
  });

  it("says Google couldn't be reached when the request fails", async () => {
    tokenAnswer = () => {
      throw new TypeError("fetch failed");
    };

    await expect(identityOf()).rejects.toThrow("couldn't be reached");
  });

  it("logs neither the client secret, the code nor any token, whatever happens", async () => {
    await identityOf();
    for (const answer of [
      () => tokensAnswer(idTokenOf({ aud: "another" })),
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

  it("is available only while a client is saved, and works only at localhost and the public address over HTTPS", async () => {
    const publicAddress = "https://office.example.com";
    const at = (kind: "localhost" | "loopback-ip" | "local-network-ip" | "public", host: string) =>
      google.unavailableAt({ kind, host, secure: kind === "public", publicAddress });

    expect(await google.isAvailable()).toBe(true);
    expect(at("localhost", "localhost:4310")).toBeUndefined();
    expect(at("public", "office.example.com")).toBeUndefined();
    expect(at("loopback-ip", "127.0.0.1:4310")).toEqual({
      reason: "ip-address",
      elsewhere: "http://localhost:4310",
    });
    expect(at("local-network-ip", "192.168.1.20:4310")).toEqual({
      reason: "needs-https-domain",
      elsewhere: publicAddress,
    });

    await clients.remove();
    expect(await google.isAvailable()).toBe(false);
    await expect(identityOf()).rejects.toThrow("isn't set up");
  });
});
