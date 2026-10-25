import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommandLineGit } from "./command-line-git.js";

const git = new CommandLineGit();
let folder: string;
let repository: string;

function runGit(cwd: string, ...gitArguments: string[]): void {
  execFileSync("git", gitArguments, { cwd, stdio: "ignore" });
}

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-git-"));
  repository = join(folder, "repository");
  await mkdir(join(repository, "src"), { recursive: true });
  await writeFile(join(repository, "src", "index.ts"), "export {};\n");
  runGit(repository, "init", "--quiet", "--initial-branch", "main");
  runGit(repository, "add", ".");
  // An identity of its own: the Linux check's container has none configured.
  runGit(
    repository,
    "-c",
    "user.name=The Office",
    "-c",
    "user.email=office@localhost",
    "commit",
    "--quiet",
    "--message",
    "First commit",
  );
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("CommandLineGit.inspect", () => {
  it("knows a repository's top-level folder", async () => {
    await expect(git.inspect(repository)).resolves.toEqual({ kind: "repository" });
  });

  it("names the repository a folder inside one belongs to", async () => {
    const inspection = await git.inspect(join(repository, "src"));

    expect(inspection.kind).toBe("inside-a-repository");
    // The temp folder may be named differently by git (a short name on Windows), so only its end.
    expect(inspection.kind === "inside-a-repository" && inspection.root).toMatch(/repository$/);
  });

  it("tells a folder that is no repository, in git's words", async () => {
    await expect(git.inspect(folder)).resolves.toMatchObject({
      kind: "not-a-repository",
      detail: expect.stringMatching(/not a git repository/i),
    });
  });

  it("tells a missing folder from a file", async () => {
    await expect(git.inspect(join(folder, "nowhere"))).resolves.toEqual({ kind: "missing" });
    await expect(git.inspect(join(repository, "src", "index.ts"))).resolves.toEqual({
      kind: "not-a-folder",
    });
  });
});

describe("CommandLineGit.hasBranch", () => {
  it("finds a local branch", async () => {
    await expect(git.hasBranch(repository, "main")).resolves.toBe(true);
  });

  it.each(["develop", "main..other", "-x"])("finds no branch %s", async (branch) => {
    await expect(git.hasBranch(repository, branch)).resolves.toBe(false);
  });
});
