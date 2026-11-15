import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHubOfficeReleases } from "./github-office-releases.js";

interface Answer {
  readonly status: number;
  readonly body?: unknown;
  /** Never answers, so the read times out. */
  readonly hang?: boolean;
}

let server: Server;
let apiUrl: string;
let answer: Answer;
let asked: string[];

function githubRelease(tag: string, overrides: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    name: `The Office ${tag}`,
    body: `Notes of ${tag}`,
    html_url: `https://github.com/owner/the-office/releases/tag/${tag}`,
    published_at: "2026-11-14T10:00:00Z",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: `the-office-${tag.slice(1)}-linux-x64.tar.gz`,
        browser_download_url: `https://github.com/owner/the-office/releases/download/${tag}/x64.tar.gz`,
      },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  asked = [];
  answer = { status: 200, body: [] };
  server = createServer((request, response) => {
    asked.push(request.url ?? "");
    if (answer.hang) return;
    response.writeHead(answer.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(answer.body ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("GitHub Releases", () => {
  it("lists the releases newer than the version, newest first, with their notes and assets", async () => {
    answer = {
      status: 200,
      body: [
        githubRelease("v1.4.0"),
        githubRelease("v1.10.0", { name: null, body: null }),
        githubRelease("v1.3.0"),
        githubRelease("v1.2.9"),
      ],
    };

    const newer = await new GitHubOfficeReleases(apiUrl).newerThan("owner/the-office", "1.3.0");

    expect(asked).toEqual(["/repos/owner/the-office/releases?per_page=30"]);
    expect(newer.map(({ version, name, notes }) => [version, name, notes])).toEqual([
      ["1.10.0", "1.10.0", ""],
      ["1.4.0", "The Office v1.4.0", "Notes of v1.4.0"],
    ]);
    expect(newer[1]).toMatchObject({
      publishedAt: new Date("2026-11-14T10:00:00Z"),
      url: "https://github.com/owner/the-office/releases/tag/v1.4.0",
      assets: [
        {
          name: "the-office-1.4.0-linux-x64.tar.gz",
          url: "https://github.com/owner/the-office/releases/download/v1.4.0/x64.tar.gz",
        },
      ],
    });
  });

  it("leaves out drafts, pre-releases and tags that aren't a version", async () => {
    answer = {
      status: 200,
      body: [
        githubRelease("v2.0.0", { draft: true, published_at: null }),
        githubRelease("v1.9.0", { prerelease: true }),
        githubRelease("v1.8.0-rc.1"),
        githubRelease("nightly"),
        githubRelease("v1.5.0"),
      ],
    };

    const newer = await new GitHubOfficeReleases(apiUrl).newerThan("owner/the-office", "1.3.0");

    expect(newer.map(({ version }) => version)).toEqual(["1.5.0"]);
  });

  it("fails with GitHub's answer when the repository isn't there", async () => {
    answer = { status: 404, body: { message: "Not Found" } };

    await expect(new GitHubOfficeReleases(apiUrl).newerThan("owner/gone", "1.3.0")).rejects.toThrow(
      "GitHub answered 404 for owner/gone's releases.",
    );
  });

  it("gives up when GitHub doesn't answer in time", async () => {
    answer = { status: 200, hang: true };

    await expect(
      new GitHubOfficeReleases(apiUrl, 50).newerThan("owner/the-office", "1.3.0"),
    ).rejects.toThrow("GitHub didn't answer within 0.05 s.");
  });
});
