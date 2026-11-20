import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checksumLine,
  claudeCodeProblems,
  installedPackageProblems,
  isReleased,
  RELEASE_FILES,
  releasePackageJson,
  releaseStamp,
  tarballName,
  unwantedClaudeCodePackages,
} from "./release-package.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SDK = "@anthropic-ai/claude-agent-sdk";

/** Whether the release carries `path` from the checkout. */
function carries(path: string): boolean {
  return (
    isReleased(path) &&
    RELEASE_FILES.some((file) => path === file.path || path.startsWith(`${file.path}/`))
  );
}

describe("an Office release's tarball", () => {
  it("is named by its version and CPU, with a checksum line sha256sum -c reads", () => {
    assert.equal(tarballName("1.2.3", "arm64"), "the-office-1.2.3-linux-arm64.tar.gz");
    assert.equal(
      checksumLine("ab12", "the-office-1.2.3-linux-x64.tar.gz"),
      "ab12  the-office-1.2.3-linux-x64.tar.gz\n",
    );
  });

  it("carries the knowledge base's index and the glossary it links to, at their checkout paths", () => {
    for (const path of ["docs/spec/README.md", "GLOSSARY.md"]) {
      assert.equal(existsSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url))), true);
      assert.equal(carries(path), true, `${path} is released`);
    }
    // The mock-ups are for design work only.
    assert.equal(carries("docs/design/README.md"), false);
  });

  it("carries the built service, web app, contracts, migrations, launcher and knowledge base, without tests or build state", () => {
    assert.deepEqual(
      RELEASE_FILES.map(({ path }) => path),
      [
        "LICENSE",
        ".env.example",
        "apps/service/package.json",
        "apps/service/dist",
        "apps/service/drizzle",
        "apps/web/package.json",
        "apps/web/dist",
        "packages/contracts/package.json",
        "packages/contracts/dist",
        "tools/office-launcher/package.json",
        "tools/office-launcher/src",
        "docs/spec",
        "GLOSSARY.md",
      ],
    );
    assert.equal(isReleased("tools/office-launcher/src/launcher.ts"), true);
    assert.equal(isReleased("tools/office-launcher/src/launcher.test.ts"), false);
    assert.equal(isReleased("apps/service/dist/tsconfig.build.tsbuildinfo"), false);
  });

  it("trims the root package.json to the released workspaces and scripts, at the version", () => {
    const released = releasePackageJson(
      {
        name: "the-office",
        private: true,
        license: "GPL-3.0-only",
        type: "module",
        workspaces: ["apps/*", "packages/*", "tools/*"],
        scripts: { start: "npm run start --workspace @the-office/service", verify: "npm run test" },
        engines: { node: ">=22.18 <23" },
        devDependencies: { typescript: "7.0.2" },
      },
      "1.2.3",
    );

    assert.deepEqual(released, {
      name: "the-office",
      version: "1.2.3",
      private: true,
      license: "GPL-3.0-only",
      type: "module",
      workspaces: ["apps/service", "apps/web", "packages/contracts", "tools/office-launcher"],
      scripts: { start: "npm run start --workspace @the-office/service" },
      engines: { node: ">=22.18 <23" },
    });
  });

  it("stamps the version and the commit it was built from", () => {
    const line = `${COMMIT}\x1f2026-11-14T10:00:00+01:00\x1ffeat: releases\n`;

    assert.deepEqual(releaseStamp("1.2.3", line), {
      version: "1.2.3",
      commit: COMMIT,
      committedAt: "2026-11-14T10:00:00+01:00",
      subject: "feat: releases",
    });
    assert.throws(() => releaseStamp("1.2.3", "fatal: not a git repository"), /Not a commit/);
  });

  it("stamps the GitHub repository it is released from, where the service looks for newer ones", () => {
    const line = `${COMMIT}\x1f2026-11-14T10:00:00+01:00\x1ffeat: releases\n`;

    assert.equal(releaseStamp("1.2.3", line, "owner/the-office").repository, "owner/the-office");
    assert.throws(() => releaseStamp("1.2.3", line, "the-office"), /owner\/name/);
  });
});

describe("a release's Claude Code", () => {
  it("keeps only its own CPU's glibc build", () => {
    const installed = [SDK, `${SDK}-linux-x64`, `${SDK}-linux-x64-musl`];

    assert.deepEqual(unwantedClaudeCodePackages(installed, "x64"), [`${SDK}-linux-x64-musl`]);
    assert.deepEqual(claudeCodeProblems([SDK, `${SDK}-linux-x64`], "x64"), []);
  });

  it("refuses a missing build and another platform's", () => {
    assert.deepEqual(
      claudeCodeProblems([SDK, `${SDK}-linux-x64`, `${SDK}-darwin-arm64`], "arm64"),
      [
        `${SDK}-linux-arm64, with Claude Code for linux-arm64, is missing.`,
        `${SDK}-linux-x64 doesn't belong in a release for linux-arm64.`,
        `${SDK}-darwin-arm64 doesn't belong in a release for linux-arm64.`,
      ],
    );
  });
});

describe("a release's node_modules", () => {
  const lockfile = {
    packages: {
      "node_modules/zod": { version: "4.6.7" },
      "node_modules/vitest": { version: "5.0.5", dev: true },
      "apps/service/node_modules/yaml": { version: "2.9.1" },
    },
  };

  it("holds the lockfile's production packages at their versions", () => {
    const installed = [
      { path: "node_modules/zod", version: "4.6.7" },
      { path: "apps/service/node_modules/yaml", version: "2.9.1" },
    ];

    assert.deepEqual(installedPackageProblems(installed, lockfile), []);
  });

  it("refuses a devDependency, another version and a package the lockfile doesn't hold", () => {
    const installed = [
      { path: "node_modules/vitest", version: "5.0.5" },
      { path: "node_modules/zod", version: "4.6.8" },
      { path: "node_modules/left-pad", version: "1.3.0" },
    ];

    assert.deepEqual(installedPackageProblems(installed, lockfile), [
      "node_modules/vitest is a devDependency.",
      "node_modules/zod is at 4.6.8, but package-lock.json holds 4.6.7.",
      "node_modules/left-pad isn't in package-lock.json.",
    ]);
  });
});
