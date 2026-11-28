import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvedInside } from "./resolved-inside.js";

let folder: string;
let worktree: string;
let outside: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "resolved-inside-"));
  worktree = join(folder, "worktree");
  outside = join(folder, "host-secret");
  await mkdir(join(worktree, "nested"), { recursive: true });
  await writeFile(join(worktree, "package-lock.json"), "{}");
  await writeFile(outside, "s3cret");
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("resolvedInside", () => {
  it("answers a file of the folder, and one a link inside it leads to, by its real path", async () => {
    await symlink(join(worktree, "package-lock.json"), join(worktree, "nested", "lockfile"));
    // The temporary folder's own real path, which on Windows may differ from its short name.
    const lockfile = await realpath(join(worktree, "package-lock.json"));

    await expect(resolvedInside(worktree, join(worktree, "package-lock.json"))).resolves.toEqual({
      state: "inside",
      path: lockfile,
    });
    await expect(resolvedInside(worktree, join(worktree, "nested", "lockfile"))).resolves.toEqual({
      state: "inside",
      path: lockfile,
    });
  });

  it("refuses a link leading out of the folder, through a file or a folder, or to nothing", async () => {
    await symlink(outside, join(worktree, "secret"));
    // A junction on Windows, which needs no privilege there; a link elsewhere.
    await symlink(folder, join(worktree, "parent"), "junction");
    await symlink(join(folder, "gone"), join(worktree, "dangling"));

    for (const path of ["secret", join("parent", "host-secret"), "dangling"]) {
      await expect(resolvedInside(worktree, join(worktree, path))).resolves.toEqual({
        state: "outside",
      });
    }
    await expect(resolvedInside(worktree, join(worktree, "..", "host-secret"))).resolves.toEqual({
      state: "outside",
    });
  });

  it("answers missing for nothing there, or no folder at all", async () => {
    await expect(resolvedInside(worktree, join(worktree, "absent.json"))).resolves.toEqual({
      state: "missing",
    });
    await expect(
      resolvedInside(join(folder, "no-worktree"), join(folder, "no-worktree", "a")),
    ).resolves.toEqual({ state: "missing" });
  });
});
