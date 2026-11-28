/**
 * Where GitHub is, for the Office identity: its website, whose https remotes take Sign in with
 * GitHub and whose host its ssh remotes reach, and its REST API, which publishes GitHub's ssh host
 * keys. Every decision that a remote is on GitHub reads `webUrl`, so a fake GitHub stands in for
 * all of them.
 */
export abstract class GitHubSite {
  /** GitHub's website, such as `https://github.com`. */
  abstract readonly webUrl: string;
  /** GitHub's REST API, such as `https://api.github.com`. */
  abstract readonly apiUrl: string;
}

export const GITHUB_SITE: GitHubSite = {
  webUrl: "https://github.com",
  apiUrl: "https://api.github.com",
};

/** The host GitHub's ssh remotes name: its website's. */
export function gitHubSshHostOf(site: GitHubSite): string {
  return new URL(site.webUrl).hostname;
}

/** Where GitHub publishes its ssh host keys: https://docs.github.com/rest/meta/meta */
export function gitHubMetaUrlOf(site: GitHubSite): string {
  return `${site.apiUrl.replace(/\/+$/, "")}/meta`;
}
