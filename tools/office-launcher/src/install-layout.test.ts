import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { installLayoutOf } from "./install-layout.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "office-layout-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function releaseFolder(parent: string, version = "1.2.0"): string {
  const release = join(root, parent, version);
  mkdirSync(release, { recursive: true });
  writeFileSync(join(release, "office-release.json"), JSON.stringify({ version }));
  return release;
}

describe("the install layout", () => {
  test("a folder with .git is a checkout", () => {
    mkdirSync(join(root, ".git"));
    assert.deepEqual(installLayoutOf(root), { mode: "checkout", repository: root });
  });

  test("a release in releases/, with current a link beside it, is a direct install", () => {
    const release = releaseFolder("releases");
    symlinkSync(join("releases", "1.2.0"), join(root, "current"));

    assert.deepEqual(installLayoutOf(release), { mode: "release", release, installRoot: root });
  });

  test("a release outside releases/, or with no current link, isn't installed", () => {
    const elsewhere = releaseFolder("unpacked");
    symlinkSync(join("unpacked", "1.2.0"), join(root, "current"));
    const unlinked = releaseFolder(join("other", "releases"));
    mkdirSync(join(root, "other", "current"));

    assert.equal(installLayoutOf(elsewhere).mode, "not-installed");
    assert.equal(installLayoutOf(unlinked).mode, "not-installed");
    assert.equal(installLayoutOf(join(root, "nothing")).mode, "not-installed");
  });
});
