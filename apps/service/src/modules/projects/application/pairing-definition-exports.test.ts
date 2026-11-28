import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../office-identity/index.fixtures.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { PairingDefinitionExports } from "./pairing-definition-exports.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBasesForTests } from "./task-bases.fixtures.js";

/** The one Project kept: only finding it matters here. */
class OneProject extends ProjectRepository {
  constructor(private readonly project: Project) {
    super();
  }

  find(id: string): Promise<Project | undefined> {
    return Promise.resolve(id === this.project.id ? this.project : undefined);
  }

  add = notUsed;
  list = notUsed;
  update = notUsed;
}

function notUsed(): never {
  throw new Error("Not used by the pairing definition's export.");
}

let repository: TemporaryRepository;
let project: Project;
let exports: PairingDefinitionExports;

/** Commits the files on main and pushes it to the origin. */
async function commitOnMain(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(repository.path, path)), { recursive: true });
    await writeFile(join(repository.path, path), content);
  }
  gitIn(repository.path, "add", ".");
  gitIn(repository.path, "commit", "--quiet", "--message", "Add files");
  gitIn(repository.path, "push", "--quiet", "origin", "main");
}

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  project = aProject({ path: repository.path, baseBranch: "main" });
  const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  exports = new PairingDefinitionExports(
    new OneProject(project),
    new TaskBasesForTests(git),
    git,
    new ProjectCommandRunner(new ShellCommandRunner()),
  );
}, REAL_GIT_TEST.timeout);

afterAll(async () => {
  await repository.remove();
});

describe("The pairing environment's definition (spec §5.5)", REAL_GIT_TEST, () => {
  it("refuses in words a base branch with no .devcontainer/, leaving no folder", async () => {
    const before = await readdir(tmpdir());

    const refused = await exports.exportDefinition(project.id).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ProjectRefused);
    expect((refused as ProjectRefused).reasons[0]).toMatch(
      new RegExp(`^main of ${project.name} has no \\.devcontainer/ folder at [0-9a-f]{7}\\.$`),
    );
    const left = (await readdir(tmpdir())).filter(
      (name) => name.startsWith("office-pairing-definition-") && !before.includes(name),
    );
    expect(left).toEqual([]);
  });

  it("holds the base branch tip's .devcontainer/ alone, fetched first, and is removed whole", async () => {
    await commitOnMain({
      ".devcontainer/devcontainer.json": '{ "image": "node:22" }\n',
      ".devcontainer/android/Dockerfile": "FROM debian:12\n",
      "README.md": "# Shop\n",
    });

    const exported = await exports.exportDefinition(project.id);

    expect(exported.folder).toMatch(/office-pairing-definition-/);
    expect(await readdir(exported.folder)).toEqual([".devcontainer"]);
    expect((await readdir(join(exported.folder, ".devcontainer"))).toSorted()).toEqual([
      "android",
      "devcontainer.json",
    ]);
    await expect(
      readFile(join(exported.folder, ".devcontainer", "android", "Dockerfile"), "utf8"),
    ).resolves.toBe("FROM debian:12\n");
    expect(gitIn(repository.path, "status", "--porcelain")).toBe("");

    await exported.remove();
    await exported.remove();

    await expect(stat(exported.folder)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
