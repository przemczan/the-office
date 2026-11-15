import { z } from "zod";
import {
  compareVersions,
  isNewer,
  parseVersion,
  versionText,
} from "../../domain/office-version.js";
import type { PublishedRelease } from "../../domain/published-release.js";
import { OfficeReleases } from "../../ports/office-releases.js";

/** How long a read of GitHub Releases may take before the check gives up on it. */
const READ_TIMEOUT_MS = 30_000;
/** GitHub's newest releases first; a version 30 releases behind updates in more than one go. */
const RELEASES_READ = 30;

const releasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    name: z.string().nullable(),
    body: z.string().nullable(),
    html_url: z.string(),
    published_at: z.iso.datetime().nullable(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })),
  }),
);
type GitHubRelease = z.infer<typeof releasesSchema>[number];

/**
 * GitHub Releases, read unauthenticated through GitHub's API (`OFFICE_GITHUB_API_URL`): a public
 * repository's releases need no sign-in, and The Office's own GitHub access is for Projects alone.
 */
export class GitHubOfficeReleases extends OfficeReleases {
  constructor(
    private readonly apiUrl: string,
    private readonly timeoutMs = READ_TIMEOUT_MS,
  ) {
    super();
  }

  async newerThan(repository: string, version: string): Promise<PublishedRelease[]> {
    const running = parseVersion(version);
    if (!running) throw new Error(`${version} isn't a released version.`);
    const releases = releasesSchema.parse(await this.read(repository));
    return releases
      .flatMap((release) => {
        const published = publishedRelease(release);
        return published ? [published] : [];
      })
      .filter(({ parsed }) => isNewer(parsed, running))
      .toSorted((a, b) => compareVersions(b.parsed, a.parsed))
      .map(({ release }) => release);
  }

  private async read(repository: string): Promise<unknown> {
    const url = new URL(`repos/${repository}/releases`, `${this.apiUrl.replace(/\/$/, "")}/`);
    url.searchParams.set("per_page", String(RELEASES_READ));
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "The Office" },
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      throw new Error(
        error instanceof Error && error.name === "TimeoutError"
          ? `GitHub didn't answer within ${this.timeoutMs / 1000} s.`
          : `GitHub couldn't be reached: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for ${repository}'s releases.`);
    }
    return response.json();
  }
}

/** A release that counts: published, no draft or pre-release, tagged with a version. */
function publishedRelease(release: GitHubRelease) {
  const parsed = parseVersion(release.tag_name);
  if (!parsed || release.draft || release.prerelease || !release.published_at) return undefined;
  const version = versionText(parsed);
  const published: PublishedRelease = {
    version,
    name: release.name?.trim() || version,
    publishedAt: new Date(release.published_at),
    notes: release.body ?? "",
    url: release.html_url,
    assets: release.assets.map(({ name, browser_download_url }) => ({
      name,
      url: browser_download_url,
    })),
  };
  return { parsed, release: published };
}
