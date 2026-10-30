import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { KnownPipelines } from "../ports/known-pipelines.js";
import { LocalRepositories, MANIFEST_CHARACTERS } from "./local-repositories.js";
import { ProjectChecks } from "./project-checks.js";

let repository: TemporaryRepository;
const localRepositories = new LocalRepositories(
  new ProjectChecks(new CommandLineGit(new RepositoryLocks()), {} as KnownPipelines),
);

beforeAll(async () => {
  repository = await createTemporaryRepository();
  await writeFile(join(repository.path, "package.json"), '{ "name": "admin-panel" }\n');
  await writeFile(join(repository.path, "README.md"), "x".repeat(MANIFEST_CHARACTERS + 10));
  await writeFile(join(repository.path, "package-lock.json"), "{}\n");
  await mkdir(join(repository.path, "docs"));
  await writeFile(join(repository.path, "docs", "package.json"), "{}\n");
}, REAL_GIT_TEST.timeout);

afterAll(async () => {
  await rm(repository.folder, { recursive: true, force: true });
});

describe("LocalRepositories", REAL_GIT_TEST, () => {
  it("reads the top level and the manifest files there, a long one cut, nothing below", async () => {
    const { entries, manifests } = await localRepositories.read(repository.path);

    expect(entries).toEqual([
      { name: "docs", kind: "folder" },
      { name: "package-lock.json", kind: "file" },
      { name: "package.json", kind: "file" },
      { name: "README.md", kind: "file" },
      { name: "src", kind: "folder" },
    ]);
    expect(manifests).toEqual([
      { name: "package.json", text: '{ "name": "admin-panel" }\n', cut: false },
      { name: "README.md", text: "x".repeat(MANIFEST_CHARACTERS), cut: true },
    ]);
  });

  it.each<[string, () => { path: string; reason: string }]>([
    [
      "a relative path",
      () => ({
        path: "repository",
        reason: "Give the repository's full path, not a relative one.",
      }),
    ],
    [
      "a folder that isn't there",
      () => {
        const path = join(repository.folder, "missing");
        return { path, reason: `There is no folder at ${path}.` };
      },
    ],
    [
      "a folder that is no repository",
      () => ({ path: repository.folder, reason: `${repository.folder} is not a git repository` }),
    ],
    [
      "a folder inside a repository",
      () => {
        const path = join(repository.path, "src");
        return { path, reason: `${path} is inside the repository at` };
      },
    ],
  ])("refuses %s, as adding a Project does", async (_, given) => {
    const { path, reason } = given();

    const read = localRepositories.read(path);

    await expect(read).rejects.toBeInstanceOf(ProjectRefused);
    await expect(read).rejects.toThrow(reason);
  });
});
