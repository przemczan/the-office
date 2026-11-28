import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../office-identity/index.fixtures.js";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  commitOnOrigin,
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
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBasesForTests } from "./task-bases.fixtures.js";
import { TestInstanceCheckouts } from "./test-instance-checkouts.js";

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
  throw new Error("Not used by test instances' checkouts.");
}

const BRANCH = "initiative/devices";

let repository: TemporaryRepository;
let officeData: OfficeDataDirectory;
let project: Project;
let checkouts: TestInstanceCheckouts;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  gitIn(repository.path, "branch", BRANCH, "origin/main");
  gitIn(repository.path, "push", "--quiet", "origin", BRANCH);
  officeData = new OfficeDataDirectory(join(repository.folder, "office-data"));
  project = aProject({
    path: repository.path,
    installCommand: "npm ci",
    installInputs: ["package-lock.json"],
    environment: {
      set: [{ name: "REGISTRY", value: "https://registry.example.test", secret: false }],
      unset: [],
      prependPath: [],
    },
  });
  const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  checkouts = new TestInstanceCheckouts(
    new OneProject(project),
    new TaskBasesForTests(git),
    git,
    new ProjectCommandRunner(new ShellCommandRunner()),
    officeData,
  );
}, REAL_GIT_TEST.timeout);

afterAll(async () => {
  await repository.remove();
});

describe("A test instance's checkout (spec §5.5)", REAL_GIT_TEST, () => {
  it("is a plain checkout of the branch's tip fetched from the remote, unknown to the repository, removed whole", async () => {
    const newer = await commitOnOrigin(repository, BRANCH, "rename-dialog.ts", "export {};\n");
    const folder = officeData.testInstanceFolder("instance-1");

    const { commit } = await checkouts.checkOut(project.id, BRANCH, folder);

    expect(commit).toBe(newer);
    await expect(readFile(join(folder, "rename-dialog.ts"), "utf8")).resolves.toBe("export {};\n");
    await expect(readFile(join(folder, "src", "index.ts"), "utf8")).resolves.toBe("export {};\n");
    // No `.git` at all: nothing in it leads back to the repository or its remotes.
    await expect(stat(join(folder, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(gitIn(repository.path, "worktree", "list", "--porcelain")).not.toContain("instance-1");
    expect(gitIn(repository.path, "status", "--porcelain")).toBe("");

    await checkouts.remove(folder);
    await checkouts.remove(folder);

    await expect(stat(folder)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("knows the branch's tip without a fetch: the newer of the local branch and its fetched copy", async () => {
    const newer = await commitOnOrigin(repository, BRANCH, "share-dialog.ts", "export {};\n");

    // Not fetched yet: the repository knows only the tip the last checkout took.
    await expect(checkouts.branchCommitOf(project.id, BRANCH)).resolves.not.toBe(newer);
    const { commit } = await checkouts.checkOut(
      project.id,
      BRANCH,
      officeData.testInstanceFolder("instance-3"),
    );

    expect(commit).toBe(newer);
    await expect(checkouts.branchCommitOf(project.id, BRANCH)).resolves.toBe(newer);
    await expect(checkouts.branchCommitOf(project.id, "initiative/gone")).resolves.toBeUndefined();
    await checkouts.remove(officeData.testInstanceFolder("instance-3"));
  });

  it("checks out a branch only the remote has", async () => {
    const tip = await commitOnOrigin(repository, "feature/pushed-elsewhere", "pushed.ts");
    const folder = officeData.testInstanceFolder("instance-4");

    const { commit } = await checkouts.checkOut(project.id, "feature/pushed-elsewhere", folder);

    expect(commit).toBe(tip);
    await expect(readFile(join(folder, "pushed.ts"), "utf8")).resolves.toBe("from the origin\n");
    await checkouts.remove(folder);
  });

  it("refuses a branch neither the Project nor its remote has, naming it, leaving no folder", async () => {
    const folder = officeData.testInstanceFolder("instance-2");

    const checkingOut = checkouts.checkOut(project.id, "initiative/gone", folder);

    await expect(checkingOut).rejects.toBeInstanceOf(ProjectRefused);
    await expect(checkingOut).rejects.toMatchObject({
      reasons: [`The branch initiative/gone isn't in ${project.name} or on its remote.`],
    });
    await expect(stat(folder)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes and removes nothing outside the test instances' folder", async () => {
    await expect(checkouts.checkOut(project.id, BRANCH, repository.path)).rejects.toThrow(
      "isn't a test instance's folder",
    );
    await expect(checkouts.remove(repository.folder)).rejects.toThrow(
      "isn't a test instance's folder",
    );
    await expect(stat(repository.path)).resolves.toBeDefined();
  });

  it("answers the install the Project's run environment image is made from, as a Task's", async () => {
    await expect(checkouts.installSettingsOf(project.id)).resolves.toEqual({
      installCommand: "npm ci",
      installInputs: ["package-lock.json"],
      installVariables: [
        { name: "REGISTRY", value: "https://registry.example.test", secret: false },
      ],
    });
  });

  it("runs a build in the checkout with the target's variables only, appending to the log", async () => {
    const checkout = join(officeData.folder("test-instances"), "build-1");
    await checkouts.checkOut(project.id, BRANCH, checkout);
    const logFile = join(officeData.folder("test-instances"), "build-1.log");

    const ended = await checkouts.runBuild({
      checkout,
      folder: ".",
      commandLine: `node -e "console.log(process.env.FLAVOUR, process.env.REGISTRY ?? 'none', process.env.SIGNING)"`,
      variables: [
        { name: "FLAVOUR", value: "debug", secret: false },
        { name: "SIGNING", value: "s3cret-key", secret: true },
      ],
      logFile,
      timeoutMs: 20_000,
    });

    expect(ended).toEqual({ outcome: "passed", exitCode: 0 });
    expect(await readFile(logFile, "utf8")).toBe("debug none [secret SIGNING]\n");
    await checkouts.remove(checkout);
  });

  it("refuses a build folder outside the checkout", async () => {
    const checkout = join(officeData.folder("test-instances"), "build-2");

    await expect(
      checkouts.runBuild({
        checkout,
        folder: "../elsewhere",
        commandLine: "true",
        variables: [],
        logFile: join(officeData.folder("test-instances"), "build-2.log"),
        timeoutMs: 20_000,
      }),
    ).rejects.toBeInstanceOf(ProjectRefused);
  });
});
