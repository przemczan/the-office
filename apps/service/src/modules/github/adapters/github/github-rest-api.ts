import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { gitHubUrl, GitHubUrls } from "../../application/github-urls.js";
import type { GitHubApp } from "../../domain/github-app.js";
import {
  GitHubApi,
  GitHubApiFailure,
  type SignInCode,
  type TokenAnswer,
} from "../../ports/github-api.js";

const REST_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};

/**
 * The part of the manifest conversion's answer that is kept. zod drops every other key, so the
 * private key and webhook secret leave this file in no value.
 */
const convertedAppSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  slug: z.string().min(1),
  // A user's or organization's login; an enterprise owner has a slug instead.
  owner: z.union([z.object({ login: z.string().min(1) }), z.object({ slug: z.string().min(1) })]),
});

const refusalSchema = z.object({ error: z.string().min(1) });

/** The tokens GitHub hands out; the expiries and the refresh token are left out when tokens don't expire. */
const userTokensSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
});

const userSchema = z.object({ login: z.string().min(1) });

/**
 * GitHub's REST API (docs.github.com/rest) and the token endpoint on its website
 * (docs.github.com/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
 * on the base URLs The Office is given.
 */
@Injectable()
export class GitHubRestApi extends GitHubApi {
  constructor(private readonly urls: GitHubUrls) {
    super();
  }

  async convertManifestCode(code: string): Promise<GitHubApp> {
    const url = gitHubUrl(this.urls.api, `/app-manifests/${encodeURIComponent(code)}/conversions`);
    const response = await this.call(url, { method: "POST", headers: REST_HEADERS });
    if (response.status !== 201) {
      throw new GitHubApiFailure(conversionRefusal(response.status));
    }
    const parsed = convertedAppSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      throw new GitHubApiFailure(
        "GitHub's answer didn't name the App's Client ID, client secret, slug and owner. Register the App again.",
      );
    }
    const { client_id: clientId, client_secret: clientSecret, slug, owner } = parsed.data;
    return { clientId, clientSecret, slug, owner: "login" in owner ? owner.login : owner.slug };
  }

  async exchangeSignInCode(app: GitHubApp, signIn: SignInCode): Promise<TokenAnswer> {
    // Sent in the body, never the URL, so neither the secret nor the code reaches a log of URLs.
    const response = await this.call(gitHubUrl(this.urls.web, "/login/oauth/access_token"), {
      method: "POST",
      // Without it, GitHub answers form-encoded.
      headers: { accept: "application/json" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code: signIn.code,
        redirect_uri: signIn.redirectUri,
        code_verifier: signIn.codeVerifier,
      }),
    });
    const body: unknown = await response.json().catch(() => undefined);
    // GitHub refuses in an `error` field, whatever the status.
    const refusal = refusalSchema.safeParse(body);
    if (refusal.success) return { kind: "refused", error: refusal.data.error };
    const parsed = userTokensSchema.safeParse(body);
    if (response.status !== 200 || !parsed.success) {
      throw new GitHubApiFailure(
        `GitHub's answer to the sign-in held no token (HTTP ${response.status}). Sign in again.`,
      );
    }
    const tokens = parsed.data;
    return {
      kind: "issued",
      tokens: {
        accessToken: tokens.access_token,
        accessTokenExpiresAt: secondsFromNow(tokens.expires_in),
        refreshToken: tokens.refresh_token,
        refreshTokenExpiresAt: secondsFromNow(tokens.refresh_token_expires_in),
      },
    };
  }

  async loginOf(accessToken: string): Promise<string> {
    const response = await this.call(gitHubUrl(this.urls.api, "/user"), {
      headers: { ...REST_HEADERS, authorization: `Bearer ${accessToken}` },
    });
    const parsed = userSchema.safeParse(await response.json().catch(() => undefined));
    if (response.status !== 200 || !parsed.success) {
      throw new GitHubApiFailure(
        `GitHub didn't say who signed in (HTTP ${response.status}). Sign in again.`,
      );
    }
    return parsed.data.login;
  }

  private async call(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new GitHubApiFailure(`GitHub couldn't be reached at ${url.origin}: ${reasonOf(error)}`);
    }
  }
}

function secondsFromNow(seconds: number | undefined): Date | undefined {
  return seconds === undefined ? undefined : new Date(Date.now() + seconds * 1000);
}

function conversionRefusal(status: number): string {
  if (status === 404) {
    return "GitHub no longer knows this registration code: a code is used once, within an hour. Register the App again.";
  }
  return `GitHub refused the registration code (HTTP ${status}). Register the App again.`;
}

function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // fetch reports "fetch failed" and puts the network's reason in its cause.
  return error.cause instanceof Error ? error.cause.message : error.message;
}
