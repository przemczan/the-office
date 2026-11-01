import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { aNewProject } from "../domain/project.fixtures.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git, type FolderInspection, type Upstream } from "../ports/git.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ProjectChecks } from "./project-checks.js";

const REPOSITORY = aNewProject().path;

class FakeGit extends Git {
  constructor(
    private readonly inspection: FolderInspection = { kind: "repository" },
    private readonly branches: readonly string[] = ["main"],
    private readonly remoteTrackingBranches: readonly string[] = [],
  ) {
    super();
  }

  async inspect(): Promise<FolderInspection> {
    return this.inspection;
  }

  async hasBranch(_repositoryPath: string, branch: string): Promise<boolean> {
    return this.branches.includes(branch);
  }

  async hasRemoteBranch(_repositoryPath: string, upstream: Upstream): Promise<boolean> {
    return this.remoteTrackingBranches.includes(`${upstream.remote}/${upstream.branch}`);
  }

  // The checks only ask what a folder is and which branches it has.
  remoteBranches = notUsed;
  clone = notUsed;
  reachedUrlOf = notUsed;
  fetchBranches = notUsed;
  trackRemoteBranch = notUsed;
  setFetchUrl = notUsed;
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

const OFFICE_DATA = resolve("/office-data");
const CLONE = join(OFFICE_DATA, "repositories", "github.com", "acme", "shop");

function checksWith(git: Git = new FakeGit()): ProjectChecks {
  return new ProjectChecks(git, new FakePipelines(), new OfficeDataDirectory(OFFICE_DATA));
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

  it("passes a clone's folder with its Repository URL, in any spelling of it", async () => {
    for (const repositoryUrl of ["https://github.com/acme/shop", "git@github.com:Acme/Shop.git"]) {
      await expect(
        checksWith().checkNewProject(aNewProject({ path: CLONE, repositoryUrl })),
      ).resolves.toBeUndefined();
    }
  });

  it("refuses a Repository URL whose clone isn't the path, and one The Office doesn't clone", async () => {
    const elsewhere = aNewProject({ repositoryUrl: "https://github.com/acme/shop" });
    const notCloned = aNewProject({ path: CLONE, repositoryUrl: "git://github.com/acme/shop" });

    expect(await reasonsOf(checksWith().checkNewProject(elsewhere))).toEqual([
      `The clone of https://github.com/acme/shop is at ${CLONE}, not ${REPOSITORY}.`,
    ]);
    expect(await reasonsOf(checksWith().checkNewProject(notCloned))).toEqual([
      "The Office clones over https and ssh only, not git.",
    ]);
  });

  it("takes a clone's base branch that is only the remote's yet, and only a clone's", async () => {
    const git = new FakeGit({ kind: "repository" }, ["main"], ["origin/release"]);
    const clone = aNewProject({
      path: CLONE,
      repositoryUrl: "https://github.com/acme/shop",
      baseBranch: "release",
    });

    await expect(checksWith(git).checkNewProject(clone)).resolves.toBeUndefined();
    expect(
      await reasonsOf(checksWith(git).checkNewProject({ ...clone, repositoryUrl: undefined })),
    ).toEqual(['The repository has no branch "release".']);
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
