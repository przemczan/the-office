import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
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
import { ActionRunCheckouts } from "./action-run-checkouts.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { TaskBasesForTests } from "./task-bases.fixtures.js";

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
  throw new Error("Not used by Action runs' checkouts.");
}

const RUN = "3c1f0e2d-5b4a-4c6d-8e7f-9a0b1c2d3e4f";
const SECRET = "s3cret-deploy-token";

/** A command line printing its name with the variables a run's commands get. */
function print(name: string): string {
  return `node -e "console.log('${name}', process.env.OFFICE_ACTION, process.env.REGISTRY, process.env.DEPLOY_TOKEN)"`;
}

let repository: TemporaryRepository;
let officeData: OfficeDataDirectory;
let project: Project;
let checkouts: ActionRunCheckouts;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  officeData = new OfficeDataDirectory(join(repository.folder, "office-data"));
  project = aProject({
    path: repository.path,
    environment: {
      set: [
        { name: "REGISTRY", value: "https://registry.example.test", secret: false },
        { name: "DEPLOY_TOKEN", value: SECRET, secret: true },
      ],
      unset: [],
      prependPath: [],
    },
  });
  const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  checkouts = new ActionRunCheckouts(
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

describe("An Action run's checkout (spec §5.5)", REAL_GIT_TEST, () => {
  it("fetches the branch's tip with its subject, then writes that commit's files with no .git, its log beside it", async () => {
    const tip = await commitOnOrigin(repository, "release/1.2", "release-notes.md", "Notes\n");

    const fetched = await checkouts.branchTip(project.id, "release/1.2");
    const folder = await checkouts.checkOut(project.id, RUN, "release/1.2", fetched.commit);

    expect(fetched.commit).toBe(tip);
    expect(fetched.subject).toBe(gitIn(repository.path, "log", "-1", "--format=%s", tip).trim());
    expect(folder).toBe(join(officeData.folder("action-runs"), RUN));
    expect(checkouts.logFileOf(RUN)).toBe(join(officeData.folder("action-runs"), `${RUN}.log`));
    await expect(readFile(join(folder, "release-notes.md"), "utf8")).resolves.toBe("Notes\n");
    await expect(stat(join(folder, ".git"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(gitIn(repository.path, "status", "--porcelain")).toBe("");
    await expect(checkouts.leftoverRunIds()).resolves.toEqual([RUN]);

    await checkouts.remove(RUN);
    await checkouts.remove(RUN);

    await expect(stat(folder)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(checkouts.leftoverRunIds()).resolves.toEqual([]);
  });

  it("knows whether the remote has a branch, as a Workflow needs", async () => {
    gitIn(repository.path, "branch", "local-only", "main");

    await expect(checkouts.remoteHasBranch(project.id, "main")).resolves.toBe(true);
    await expect(checkouts.remoteHasBranch(project.id, "local-only")).resolves.toBe(false);
  });

  it("refuses a branch neither the Project nor its remote has, naming it", async () => {
    await expect(checkouts.branchTip(project.id, "gone")).rejects.toBeInstanceOf(ProjectRefused);
    await expect(checkouts.branchTip(project.id, "gone")).rejects.toMatchObject({
      reasons: [`The branch gone isn't in ${project.name} or on its remote.`],
    });
  });

  it("refuses a run id that would lead outside the Action runs' folder", () => {
    expect(() => checkouts.folderOf("../escape")).toThrow("isn't an Action run's id");
    expect(() => checkouts.logFileOf("a/b")).toThrow("isn't an Action run's id");
  });

  it("runs the commands in the checkout with the Project's variables and The Office's, each named, masking Secret variables", async () => {
    const { commit } = await checkouts.branchTip(project.id, "main");
    await checkouts.checkOut(project.id, RUN, "main", commit);

    const ended = await checkouts.run({
      runId: RUN,
      projectId: project.id,
      commands: [
        { name: "Install", commandLine: print("install") },
        { name: "Deploy", commandLine: print("deploy") },
      ],
      variables: [{ name: "OFFICE_ACTION", value: "deploy" }],
      timeoutMs: 20_000,
    });

    expect(ended).toEqual({ name: "Deploy", outcome: "passed", exitCode: 0 });
    expect(await readFile(checkouts.logFileOf(RUN), "utf8")).toBe(
      [
        "Running Install.",
        "install deploy https://registry.example.test [secret DEPLOY_TOKEN]",
        "Running Deploy.",
        "deploy deploy https://registry.example.test [secret DEPLOY_TOKEN]",
        "",
      ].join("\n"),
    );
    await checkouts.remove(RUN);
    await checkouts.removeLog(RUN);
    await expect(stat(checkouts.logFileOf(RUN))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ends on the first command that doesn't end with 0, never running the next", async () => {
    const folder = checkouts.folderOf(RUN);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "marker"), "");

    const ended = await checkouts.run({
      runId: RUN,
      projectId: project.id,
      commands: [
        { name: "Lint", commandLine: `node -e "process.exit(3)"` },
        { name: "Build", commandLine: `node -e "require('fs').rmSync('marker')"` },
      ],
      variables: [],
      timeoutMs: 20_000,
    });

    expect(ended).toEqual({ name: "Lint", outcome: "failed", exitCode: 3 });
    await expect(stat(join(folder, "marker"))).resolves.toBeDefined();
    await checkouts.remove(RUN);
    await checkouts.removeLog(RUN);
  });
});
