import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { KnownPipelines } from "../ports/known-pipelines.js";
import type { ProjectRepository } from "../ports/project-repository.js";
import { LocalRepositories } from "./local-repositories.js";
import { MANIFEST_CHARACTERS } from "./repository-folder.js";
import { ProjectChecks } from "./project-checks.js";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import type { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { EngineModels } from "../../engine/index.js";

let repository: TemporaryRepository;
const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
const localRepositories = new LocalRepositories(
  new ProjectChecks(
    git,
    {} as KnownPipelines,
    {} as OfficeDataDirectory,
    {} as EngineModels,
    {} as ProjectRepository,
  ),
  git,
);

beforeAll(async () => {
  repository = await createTemporaryRepository();
  await writeFile(join(repository.path, "package.json"), '{ "name": "admin-panel" }\n');
  await writeFile(join(repository.path, "README.md"), "x".repeat(MANIFEST_CHARACTERS + 10));
  await writeFile(join(repository.path, "package-lock.json"), "{}\n");
  await mkdir(join(repository.path, "docs"));
  await writeFile(join(repository.path, "docs", "package.json"), "{}\n");
  await mkdir(join(repository.path, "apps", "server"), { recursive: true });
  await writeFile(
    join(repository.path, "apps", "server", "package.json"),
    '{ "name": "server" }\n',
  );
  await mkdir(join(repository.folder, "elsewhere"));
  // A junction needs no rights on Windows; elsewhere it is a plain link.
  await symlink(join(repository.folder, "elsewhere"), join(repository.path, "out"), "junction");
  gitIn(repository.path, "branch", "develop");
}, REAL_GIT_TEST.timeout);

afterAll(async () => {
  await rm(repository.folder, { recursive: true, force: true });
});

describe("LocalRepositories", REAL_GIT_TEST, () => {
  it("lists the local branches, the checked-out one marked", async () => {
    const { branches } = await localRepositories.read(repository.path);

    expect(branches).toEqual([
      { name: "develop", checkedOut: false },
      { name: "main", checkedOut: true },
    ]);
  });

  it("reads a folder inside the repository as it reads the top level", async () => {
    const read = await localRepositories.read(repository.path, "apps/./server/");

    expect(read).toMatchObject({
      folder: "apps/server",
      entries: [{ name: "package.json", kind: "file" }],
      manifests: [{ name: "package.json", text: '{ "name": "server" }\n', cut: false }],
    });
  });

  it.each<[string, string, string]>([
    ["a full path", "/etc", "relative to the repository's top level"],
    ["a folder above it", "../elsewhere", "is not a folder inside the repository"],
    ["git's own folder", ".git", "is not a folder inside the repository"],
    ["a folder that isn't there", "missing", "The repository has no folder missing."],
    ["a file", "package.json", "package.json is a file, not a folder."],
    ["a link leading out", "out", "out leads outside the repository."],
  ])("refuses %s as the folder to read", async (_, folder, reason) => {
    const read = localRepositories.read(repository.path, folder);

    await expect(read).rejects.toBeInstanceOf(ProjectRefused);
    await expect(read).rejects.toThrow(reason);
  });

  it("reads the top level and the manifest files there, a long one cut, nothing below", async () => {
    const { folder, entries, manifests } = await localRepositories.read(repository.path);

    expect(folder).toBe("");
    expect(entries).toEqual([
      { name: "apps", kind: "folder" },
      { name: "docs", kind: "folder" },
      { name: "out", kind: "file" },
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
