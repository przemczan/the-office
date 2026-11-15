// Keeps the install docs true to what they describe: the one-liner, install.sh's flags, the
// release's asset names and the docs' own links.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { INSTALL_SCRIPT } from "./install-script.fixtures.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const ONE_LINER =
  "curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash";

const INSTALL_GUIDES = ["README.md", "docs/installing.md"];

const LINKED_DOCS = [
  "README.md",
  "docs/installing.md",
  "docs/running-the-office.md",
  "docs/container-runtime.md",
];

function textOf(path: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, path), "utf8");
}

/** The text outside fenced code blocks, where Markdown links are links. */
function proseOf(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, "");
}

/** GitHub's anchor for each heading: lowercased, punctuation dropped, spaces as hyphens, repeats numbered. */
function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const [, heading] of proseOf(markdown).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = (heading ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const repeats = seen.get(slug) ?? 0;
    seen.set(slug, repeats + 1);
    anchors.add(repeats === 0 ? slug : `${slug}-${repeats}`);
  }
  return anchors;
}

function relativeLinks(markdown: string): string[] {
  return [...proseOf(markdown).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map(([, target]) => target ?? "")
    .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

/** The flags each `install.sh | sudo bash -s -- …` in the text passes. */
function installerFlags(text: string): string[] {
  return [...text.matchAll(/install\.sh \| sudo bash -s -- ([^\n`]*)/g)].flatMap(([, options]) =>
    [...(options ?? "").matchAll(/(?:^|[\s[])(--[a-z][a-z-]*)/g)].map(([, flag]) => flag ?? ""),
  );
}

/** The release assets the text downloads, by name. */
function fetchedAssets(text: string): string[] {
  return [
    ...text.matchAll(
      /github\.com\/przemczan\/the-office\/releases\/(?:latest\/download|download\/v[^/\s]+)\/([^\s`)"'|]+)/g,
    ),
  ].map(([, name]) => name ?? "");
}

function releaseAssetPatterns(): RegExp[] {
  const releaseConfig = JSON.parse(textOf(".releaserc.json")) as {
    plugins: (string | [string, { assets?: { path: string }[] }])[];
  };
  const github = releaseConfig.plugins.find(
    (plugin): plugin is [string, { assets: { path: string }[] }] =>
      Array.isArray(plugin) && plugin[0] === "@semantic-release/github",
  );
  assert.ok(github, ".releaserc.json has no @semantic-release/github plugin");
  return github[1].assets.map(({ path }) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const pattern = name.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
    return new RegExp(`^${pattern}$`);
  });
}

describe("the install docs", () => {
  it("give the installer's exact one-liner", () => {
    for (const guide of INSTALL_GUIDES) {
      assert.ok(textOf(guide).includes(ONE_LINER), `${guide} lacks the one-liner`);
    }
  });

  it("pass install.sh only the flags its --help lists", () => {
    const help = spawnSync("bash", [INSTALL_SCRIPT, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    const listed = new Set(
      [...help.stdout.matchAll(/^\s+(--[a-z][a-z-]*)/gm)].map(([, flag]) => flag),
    );
    for (const guide of INSTALL_GUIDES) {
      for (const flag of installerFlags(textOf(guide))) {
        assert.ok(
          listed.has(flag),
          `${guide} passes ${flag}, which install.sh --help doesn't list`,
        );
      }
    }
    assert.ok(installerFlags(textOf("docs/installing.md")).includes("--uninstall"));
  });

  it("fetch only assets a release carries", () => {
    const patterns = releaseAssetPatterns();
    const fetched = INSTALL_GUIDES.flatMap((guide) =>
      fetchedAssets(textOf(guide)).map((name) => ({ guide, name })),
    );
    assert.ok(fetched.some(({ name }) => name === "the-office.env"));
    for (const { guide, name } of fetched) {
      assert.ok(
        patterns.some((pattern) => pattern.test(name)),
        `${guide} fetches ${name}, which .releaserc.json's assets don't hold`,
      );
    }
  });

  it("link only to files and headings the repository has", () => {
    for (const doc of LINKED_DOCS) {
      const folder = dirname(resolve(REPOSITORY_ROOT, doc));
      for (const link of relativeLinks(textOf(doc))) {
        const [path = "", anchor] = link.split("#");
        const target = path === "" ? resolve(REPOSITORY_ROOT, doc) : resolve(folder, path);
        const shown = relative(REPOSITORY_ROOT, target);
        assert.ok(existsSync(target), `${doc} links to ${link}, but ${shown} doesn't exist`);
        if (anchor !== undefined && target.endsWith(".md")) {
          assert.ok(
            headingAnchors(readFileSync(target, "utf8")).has(anchor),
            `${doc} links to ${link}, but ${shown} has no heading #${anchor}`,
          );
        }
      }
    }
  });
});
