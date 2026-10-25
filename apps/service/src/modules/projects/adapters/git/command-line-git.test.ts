import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommandLineGit } from "./command-line-git.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "./temporary-repository.fixtures.js";

const git = new CommandLineGit();
let repository: TemporaryRepository;

beforeAll(async () => {
  repository = await createTemporaryRepository();
});

afterAll(async () => {
  await repository.remove();
});

describe("CommandLineGit.inspect", () => {
  it("knows a repository's top-level folder", async () => {
    await expect(git.inspect(repository.path)).resolves.toEqual({ kind: "repository" });
  });

  it("names the repository a folder inside one belongs to", async () => {
    const inspection = await git.inspect(join(repository.path, "src"));

    expect(inspection.kind).toBe("inside-a-repository");
    // The temp folder may be named differently by git (a short name on Windows), so only its end.
    expect(inspection.kind === "inside-a-repository" && inspection.root).toMatch(/repository$/);
  });

  it("tells a folder that is no repository, in git's words", async () => {
    await expect(git.inspect(repository.folder)).resolves.toMatchObject({
      kind: "not-a-repository",
      detail: expect.stringMatching(/not a git repository/i),
    });
  });

  it("tells a missing folder from a file", async () => {
    await expect(git.inspect(join(repository.folder, "nowhere"))).resolves.toEqual({
      kind: "missing",
    });
    await expect(git.inspect(join(repository.path, "src", "index.ts"))).resolves.toEqual({
      kind: "not-a-folder",
    });
  });
});

describe("CommandLineGit.hasBranch", () => {
  it("finds a local branch", async () => {
    await expect(git.hasBranch(repository.path, "main")).resolves.toBe(true);
  });

  it.each(["develop", "main..other", "-x"])("finds no branch %s", async (branch) => {
    await expect(git.hasBranch(repository.path, branch)).resolves.toBe(false);
  });
});
