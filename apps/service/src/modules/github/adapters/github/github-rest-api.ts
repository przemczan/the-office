import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { gitHubUrl, GitHubUrls } from "../../application/github-urls.js";
import type { GitHubApp } from "../../domain/github-app.js";
import { GitHubApi, GitHubApiFailure } from "../../ports/github-api.js";

const REST_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
};

/**
 * The part of the manifest conversion's answer that is kept. zod drops every other key, so the
 * private key, client secret and webhook secret leave this file in no value.
 */
const convertedAppSchema = z.object({
  client_id: z.string().min(1),
  slug: z.string().min(1),
  // A user's or organization's login; an enterprise owner has a slug instead.
  owner: z.union([z.object({ login: z.string().min(1) }), z.object({ slug: z.string().min(1) })]),
});

/** GitHub's REST API (docs.github.com/rest), on the base URL The Office is given. */
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
        "GitHub's answer didn't name the App's Client ID, slug and owner. Register the App again.",
      );
    }
    const { client_id: clientId, slug, owner } = parsed.data;
    return { clientId, slug, owner: "login" in owner ? owner.login : owner.slug };
  }

  private async call(url: URL, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new GitHubApiFailure(`GitHub couldn't be reached at ${url.origin}: ${reasonOf(error)}`);
    }
  }
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
