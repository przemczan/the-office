import { GITHUB_SITE } from "../../../platform/config/github-site.js";

/** Where GitHub is: its website, which registers Apps and signs in, and its REST API. */
export abstract class GitHubUrls {
  abstract readonly web: string;
  abstract readonly api: string;
}

export const GITHUB_URLS: GitHubUrls = { web: GITHUB_SITE.webUrl, api: GITHUB_SITE.apiUrl };

/** GitHub's page that installs the App by `slug` on an account's repositories. */
export function appInstallUrl(urls: GitHubUrls, slug: string): URL {
  return gitHubUrl(urls.web, `/apps/${encodeURIComponent(slug)}/installations/new`);
}

/** A path under one of GitHub's base URLs, keeping the base's own path, as a fake server's has. */
export function gitHubUrl(base: string, path: string): URL {
  return new URL(`${base.replace(/\/+$/, "")}${path}`);
}
