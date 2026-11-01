import { describe, expect, it } from "vitest";
import { aNewProject } from "../domain/project.fixtures.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git, type FolderInspection } from "../ports/git.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ProjectChecks } from "./project-checks.js";

const REPOSITORY = aNewProject().path;

class FakeGit extends Git {
  constructor(
    private readonly inspection: FolderInspection = { kind: "repository" },
    private readonly branches: readonly string[] = ["main"],
  ) {
    super();
  }

  async inspect(): Promise<FolderInspection> {
    return this.inspection;
  }

  async hasBranch(_repositoryPath: string, branch: string): Promise<boolean> {
    return this.branches.includes(branch);
  }

  // The checks only ask what a folder is and which branches it has.
  localBranches = notUsed;
  upstreamOf = notUsed;
  commitOf = notUsed;
  worktreeRecordPath = notUsed;
  fetchUrlOf = notUsed;
  fetch = notUsed;
  push = notUsed;
  contains = notUsed;
  conflictsOf = notUsed;
  exclusively = notUsed;
  findCommit = notUsed;
  setRef = notUsed;
  mergeBase = notUsed;
  rebase = notUsed;
  merge = notUsed;
  mergeConflicts = notUsed;
  concludeMerge = notUsed;
  abortMerge = notUsed;
  hasMergesSince = notUsed;
  addWorktree = notUsed;
  checkoutDetached = notUsed;
  removeWorktree = notUsed;
  commit = notUsed;
  head = notUsed;
  diffSummary = notUsed;
  branchChanges = notUsed;
  restore = notUsed;
  untracked = notUsed;
  discard = notUsed;
}

function notUsed(): never {
  throw new Error("The checks change nothing in git.");
}

class FakePipelines extends KnownPipelines {
  async has(id: string): Promise<boolean> {
    return ["full", "quick-fix", "document"].includes(id);
  }
}

function checksWith(git: Git = new FakeGit()): ProjectChecks {
  return new ProjectChecks(git, new FakePipelines());
}

async function reasonsOf(checking: Promise<void>): Promise<readonly string[]> {
  const error: unknown = await checking.then(
    () => undefined,
    (refusal: unknown) => refusal,
  );
  if (!(error instanceof ProjectRefused)) throw new Error("The check passed.");
  return error.reasons;
}

describe("ProjectChecks.checkNewProject", () => {
  it("passes a repository's top-level folder with the base branch and a known Pipeline", async () => {
    await expect(checksWith().checkNewProject(aNewProject())).resolves.toBeUndefined();
  });

  it.each<[string, FolderInspection, string]>([
    ["a missing folder", { kind: "missing" }, `There is no folder at ${REPOSITORY}.`],
    ["a file", { kind: "not-a-folder" }, `${REPOSITORY} is a file, not a folder.`],
    [
      "a folder that isn't a repository",
      { kind: "not-a-repository", detail: "fatal: not a git repository" },
      `${REPOSITORY} is not a git repository: fatal: not a git repository`,
    ],
    [
      "a folder inside a repository",
      { kind: "inside-a-repository", root: "/work" },
      `${REPOSITORY} is inside the repository at /work; add that folder instead.`,
    ],
  ])("refuses %s", async (_what, inspection, reason) => {
    const checks = checksWith(new FakeGit(inspection));

    expect(await reasonsOf(checks.checkNewProject(aNewProject()))).toEqual([reason]);
  });

  it("refuses a relative path without asking git", async () => {
    const checks = checksWith(new FakeGit({ kind: "missing" }));

    expect(await reasonsOf(checks.checkNewProject(aNewProject({ path: "admin-panel" })))).toEqual([
      "Give the repository's full path, not a relative one.",
    ]);
  });

  it("refuses a base branch the repository doesn't have", async () => {
    const checks = checksWith(new FakeGit({ kind: "repository" }, ["master"]));

    expect(await reasonsOf(checks.checkNewProject(aNewProject({ baseBranch: " main " })))).toEqual([
      'The repository has no branch "main".',
    ]);
  });

  it("gives the domain's reasons, git's and the Pipeline's together", async () => {
    const checks = checksWith(new FakeGit({ kind: "missing" }));
    const newProject = aNewProject({ name: "", defaultPipeline: "nightly" });

    expect(await reasonsOf(checks.checkNewProject(newProject))).toEqual([
      "Give the Project a name.",
      `There is no folder at ${REPOSITORY}.`,
      'There is no Pipeline "nightly".',
    ]);
  });
});

describe("ProjectChecks.checkDefaultPipeline", () => {
  it("passes a known Pipeline and refuses an unknown one", async () => {
    await expect(checksWith().checkDefaultPipeline("quick-fix")).resolves.toBeUndefined();
    expect(await reasonsOf(checksWith().checkDefaultPipeline("nightly"))).toEqual([
      'There is no Pipeline "nightly".',
    ]);
  });
});
