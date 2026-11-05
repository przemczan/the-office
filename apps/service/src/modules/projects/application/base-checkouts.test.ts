import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { RepositoryLocks } from "../adapters/git/repository-locks.js";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import { ShellCommandRunner } from "../adapters/shell/shell-command-runner.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import { Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { BaseCheckouts } from "./base-checkouts.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { Worktrees } from "./worktrees.js";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";

/** The Projects as kept: only listing them matters here. */
class ListedProjects extends ProjectRepository {
  constructor(readonly projects: Project[]) {
    super();
  }

  list(): Promise<readonly Project[]> {
    return Promise.resolve(this.projects);
  }

  add = notUsed;
  find = notUsed;
  update = notUsed;
}

function notUsed(): never {
  throw new Error("Not used by base checkouts.");
}

/** Holds each fetch until `expected` have started, then fails them, the first one last. */
class FetchesThatMeet extends Worktrees {
  private readonly started: (() => void)[] = [];

  constructor(
    private readonly expected: number,
    git: Git,
    commands: ProjectCommandRunner,
    officeData: OfficeDataDirectory,
  ) {
    super(git, commands, officeData);
  }

  override freshBase(): Promise<never> {
    return new Promise((_, reject) => {
      this.started.push(() => reject(new Error("No origin.")));
      if (this.started.length < this.expected) return;
      for (const fail of this.started.toReversed()) fail();
    });
  }
}

// Real git on a temporary repository whose main tracks its origin's.
let repository: TemporaryRepository;
let project: Project;
let projects: ListedProjects;
let checkouts: BaseCheckouts;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  project = aProject({ path: repository.path });
  projects = new ListedProjects([project]);
  const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  const officeData = new OfficeDataDirectory(join(repository.folder, "office-data"));
  checkouts = new BaseCheckouts(
    projects,
    git,
    new Worktrees(git, commands, officeData),
    commands,
    officeData,
  );
});

afterAll(async () => {
  await repository.remove();
});

describe("BaseCheckouts", () => {
  it("makes the folder a chat session works in when there is no Project yet", async () => {
    const officeData = new OfficeDataDirectory(join(repository.folder, "empty-office-data"));
    const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
    const commands = new ProjectCommandRunner(new ShellCommandRunner());
    const empty = new BaseCheckouts(
      new ListedProjects([]),
      git,
      new Worktrees(git, commands, officeData),
      commands,
      officeData,
    );

    await expect(empty.refresh()).resolves.toEqual([]);
    expect((await stat(empty.folder)).isDirectory()).toBe(true);
  });

  it("names each Project's checkout under bases/ without running git", async () => {
    const folder = join(repository.folder, "office-data", "bases");

    expect(checkouts.folder).toBe(folder);
    await expect(checkouts.list()).resolves.toEqual([
      {
        projectId: "admin-panel",
        name: "Admin panel",
        baseBranch: "main",
        folder: join(folder, "admin-panel"),
      },
    ]);
  });

  it("checks the freshly fetched base branch out, and moves it on at the next refresh", async () => {
    const first = await commitOnOrigin(repository, "main", "first.txt");

    const [checkout] = await checkouts.refresh();

    const folder = checkout?.folder ?? "";
    expect(gitIn(folder, "rev-parse", "HEAD")).toBe(first);
    const second = await commitOnOrigin(repository, "main", "second.txt");
    await checkouts.refresh();
    expect(gitIn(folder, "rev-parse", "HEAD")).toBe(second);
    await expect(readFile(join(folder, "second.txt"), "utf8")).resolves.toBe("from the origin\n");
    // Real git, two commits on the origin and two refreshes: slow under a full run.
  }, 30_000);

  it("keeps the checkout it had when the fetch fails, and leaves out a Project with none", async () => {
    const [before] = await checkouts.refresh();
    const head = gitIn(before?.folder ?? "", "rev-parse", "HEAD");
    projects.projects.push(
      aProject({ id: "missing", name: "Missing", path: join(repository.folder, "gone") }),
    );
    gitIn(repository.path, "remote", "set-url", "origin", join(repository.folder, "no-origin"));

    const refreshed = await checkouts.refresh();

    expect(refreshed.map(({ projectId }) => projectId)).toEqual(["admin-panel"]);
    expect(gitIn(before?.folder ?? "", "rev-parse", "HEAD")).toBe(head);
  });

  it("refreshes Projects side by side, and answers them in their order", async () => {
    const officeData = new OfficeDataDirectory(join(repository.folder, "side-by-side-office-data"));
    const git = new CommandLineGit(new RepositoryLocks(), officeIdentityForTests());
    const commands = new ProjectCommandRunner(new ShellCommandRunner());
    const sideBySide = new BaseCheckouts(
      new ListedProjects([aProject({ id: "first" }), aProject({ id: "second" })]),
      git,
      new FetchesThatMeet(2, git, commands, officeData),
      commands,
      officeData,
    );
    await mkdir(join(sideBySide.folder, "first"), { recursive: true });
    await mkdir(join(sideBySide.folder, "second"), { recursive: true });

    const refreshed = await sideBySide.refresh();

    expect(refreshed.map(({ projectId }) => projectId)).toEqual(["first", "second"]);
  });
});
