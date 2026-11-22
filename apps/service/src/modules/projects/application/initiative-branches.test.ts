import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
import { aProject } from "../domain/project.fixtures.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import type { Project } from "../domain/project.js";
import { PullRequestRepositoryForTests } from "../ports/pull-request-repository.fixtures.js";
import { BranchDeletions } from "./branch-deletions.js";
import { InitiativeBranches } from "./initiative-branches.js";
import { PullRequestRecords } from "./pull-request-records.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import type { ProjectService } from "./project-service.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";
import { Worktrees } from "./worktrees.js";
import { TaskBasesForTests } from "./task-bases.fixtures.js";

let made: TemporaryRepository | undefined;

afterEach(async () => {
  await made?.remove();
  made = undefined;
});

/** Initiative branches on a fresh temporary repository, its main tracking origin's when asked. */
async function branchesOnARepository(tracking: boolean): Promise<{
  repository: TemporaryRepository;
  branches: InitiativeBranches;
  project: Project;
}> {
  const repository = await createTemporaryRepository();
  made = repository;
  if (tracking) {
    gitIn(repository.path, "fetch", "--quiet", "origin");
    gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  }
  const project = aProject({ path: repository.path });
  const officeData = join(repository.folder, "office-data");
  const identity = officeIdentityForTests(officeData);
  const git = new CommandLineGit(new RepositoryLocks(), identity);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  const projects = {
    read: (id: string) =>
      id === project.id ? Promise.resolve(project) : Promise.reject(new ProjectNotFound(id)),
  } as unknown as ProjectService;
  const taskBases = new TaskBasesForTests(git);
  const worktrees = new Worktrees(
    git,
    commands,
    taskCommandsOver(commands, git),
    new OfficeDataDirectory(officeData),
    taskBases,
  );
  const remotes = new ProjectRemotes(git, identity);
  const branches = new InitiativeBranches(
    projects,
    git,
    worktrees,
    commands,
    remotes,
    taskBases,
    new BranchDeletions(
      projects,
      git,
      worktrees,
      commands,
      remotes,
      taskBases,
      new PullRequestRecords(new PullRequestRepositoryForTests()),
    ),
  );
  return { repository, branches, project };
}

describe("InitiativeBranches.make", REAL_GIT_TEST, () => {
  it("makes the branch at the freshly fetched base, pushing nothing", async () => {
    const { repository, branches, project } = await branchesOnARepository(true);
    const stale = gitIn(repository.path, "rev-parse", "main");
    const fresh = await commitOnOrigin(repository, "main", "later.txt");

    const making = await branches.make(project.id, "initiative/fresh");

    expect(making).toEqual({ kind: "made", commit: fresh });
    expect(fresh).not.toBe(stale);
    expect(gitIn(repository.path, "rev-parse", "refs/heads/initiative/fresh")).toBe(fresh);
    expect(gitIn(repository.originPath, "branch", "--list", "initiative/fresh")).toBe("");
    expect(await branches.exists(project.id, "initiative/fresh")).toBe(true);
  });

  it("refuses a branch that exists locally, leaving it as it was", async () => {
    const { repository, branches, project } = await branchesOnARepository(true);
    gitIn(repository.path, "branch", "initiative/local", "main");
    const before = gitIn(repository.path, "rev-parse", "initiative/local");
    await commitOnOrigin(repository, "main", "later.txt");

    const making = await branches.make(project.id, "initiative/local");

    expect(making).toEqual({
      kind: "refused",
      reason: `The branch initiative/local already exists in ${project.name}.`,
    });
    expect(gitIn(repository.path, "rev-parse", "initiative/local")).toBe(before);
  });

  it("refuses a branch that exists on the remote, making nothing", async () => {
    const { repository, branches, project } = await branchesOnARepository(true);
    await commitOnOrigin(repository, "initiative/remote", "theirs.txt");

    const making = await branches.make(project.id, "initiative/remote");

    expect(making).toEqual({
      kind: "refused",
      reason: `The branch initiative/remote already exists on the remote of ${project.name}.`,
    });
    expect(await branches.exists(project.id, "initiative/remote")).toBe(false);
  });

  it("stays local when the base branch tracks no remote branch", async () => {
    const { repository, branches, project } = await branchesOnARepository(false);
    const local = gitIn(repository.path, "rev-parse", "main");
    await commitOnOrigin(repository, "main", "later.txt");
    // On the remote, but the base branch doesn't track it, so the remote isn't asked.
    await commitOnOrigin(repository, "initiative/local-only", "theirs.txt");

    const making = await branches.make(project.id, "initiative/local-only");

    expect(making).toEqual({ kind: "made", commit: local });
  });

  it("refuses when the base branch can't be fetched", async () => {
    const { repository, branches, project } = await branchesOnARepository(true);
    gitIn(repository.path, "remote", "set-url", "origin", join(repository.folder, "gone.git"));

    const making = await branches.make(project.id, "initiative/unfetched");

    expect(making).toMatchObject({ kind: "refused" });
    expect(making.kind === "refused" && making.reason).toMatch(
      new RegExp(`^The base branch of ${project.name} couldn't be fetched: `),
    );
    expect(await branches.exists(project.id, "initiative/unfetched")).toBe(false);
  });

  it("throws ProjectNotFound for a Project that isn't there", async () => {
    const { branches } = await branchesOnARepository(false);

    await expect(branches.make("no-such-project", "initiative/x")).rejects.toBeInstanceOf(
      ProjectNotFound,
    );
  });
});

describe("InitiativeBranches.remove", REAL_GIT_TEST, () => {
  it("takes back the branch it made, only at the commit it was made at", async () => {
    const { repository, branches, project } = await branchesOnARepository(false);
    const making = await branches.make(project.id, "initiative/taken-back");
    if (making.kind !== "made") throw new Error(making.reason);
    const other = gitIn(repository.path, "commit-tree", "main^{tree}", "-p", "main", "-m", "Other");

    await expect(branches.remove(project.id, "initiative/taken-back", other)).rejects.toThrow(
      /cannot lock ref/,
    );
    expect(await branches.exists(project.id, "initiative/taken-back")).toBe(true);

    await branches.remove(project.id, "initiative/taken-back", making.commit);
    expect(await branches.exists(project.id, "initiative/taken-back")).toBe(false);
  });
});

describe("InitiativeBranches.removeEmpty", REAL_GIT_TEST, () => {
  it("removes a branch with nothing beyond the base, here and on the remote", async () => {
    const { repository, branches, project } = await branchesOnARepository(true);
    const making = await branches.make(project.id, "initiative/empty");
    if (making.kind !== "made") throw new Error(making.reason);
    gitIn(repository.path, "push", "--quiet", "origin", "initiative/empty");
    // The base moved on since: the branch still holds nothing it lacks.
    await commitOnOrigin(repository, "main", "later.txt");

    const removal = await branches.removeEmpty(project.id, "initiative/empty");

    expect(removal).toEqual({ kind: "removed" });
    expect(await branches.exists(project.id, "initiative/empty")).toBe(false);
    expect(gitIn(repository.originPath, "branch", "--list", "initiative/empty")).toBe("");
  });

  it("refuses a branch whose copy on the remote holds a commit the base lacks, keeping both", async () => {
    const { repository, branches, project } = await branchesOnARepository(true);
    const making = await branches.make(project.id, "initiative/worked");
    if (making.kind !== "made") throw new Error(making.reason);
    await commitOnOrigin(repository, "initiative/worked", "work.txt");

    const removal = await branches.removeEmpty(project.id, "initiative/worked");

    expect(removal).toEqual({
      kind: "refused",
      reason: `The branch initiative/worked in ${project.name} holds commits ${project.baseBranch} doesn't have, so it stays.`,
    });
    expect(await branches.exists(project.id, "initiative/worked")).toBe(true);
    expect(gitIn(repository.originPath, "branch", "--list", "initiative/worked")).not.toBe("");
  });

  it("refuses a local branch holding a commit the base lacks", async () => {
    const { repository, branches, project } = await branchesOnARepository(false);
    const making = await branches.make(project.id, "initiative/local-work");
    if (making.kind !== "made") throw new Error(making.reason);
    const work = gitIn(repository.path, "commit-tree", "main^{tree}", "-p", "main", "-m", "Work");
    gitIn(repository.path, "update-ref", "refs/heads/initiative/local-work", work);

    const removal = await branches.removeEmpty(project.id, "initiative/local-work");

    expect(removal).toMatchObject({ kind: "refused" });
    expect(await branches.exists(project.id, "initiative/local-work")).toBe(true);
  });
});
