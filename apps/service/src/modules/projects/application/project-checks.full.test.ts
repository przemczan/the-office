import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { EngineModels, FIRST_CLAUDE_CODE_ENGINE } from "../../engine/index.js";
import { EngineSettingsForTests } from "../../engine/index.fixtures.js";
import type { PipelineCommands } from "../domain/pipeline-commands.js";
import { aNewProject, aProject, startingCommands } from "../domain/project.fixtures.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { Git, type FolderInspection, type Upstream } from "../ports/git.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ProjectRepository } from "../ports/project-repository.js";
import type { Project } from "../domain/project.js";
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
  readBranchTip = notUsed;
  commitTree = notUsed;
  reachedUrlOf = notUsed;
  fetchBranches = notUsed;
  trackRemoteBranch = notUsed;
  setFetchUrl = notUsed;
  localBranches = notUsed;
  branchTips = notUsed;
  upstreamOf = notUsed;
  commitOf = notUsed;
  worktreeRecordPath = notUsed;
  repositoryGitFolderOf = notUsed;
  fetchUrlOf = notUsed;
  fetch = notUsed;
  fetchRemote = notUsed;
  push = notUsed;
  pushCommit = notUsed;
  deleteRemoteBranch = notUsed;
  writeCommit = notUsed;
  mergedTree = notUsed;
  contains = notUsed;
  commitsNotIn = notUsed;
  addsNothing = notUsed;
  conflictsOf = notUsed;
  exclusively = notUsed;
  findCommit = notUsed;
  setRef = notUsed;
  createRef = notUsed;
  removeRef = notUsed;
  moveRef = notUsed;
  worktreeOf = notUsed;
  remoteHasBranch = notUsed;
  mergeBase = notUsed;
  merge = notUsed;
  fastForward = notUsed;
  hasUncommittedChanges = notUsed;
  mergeConflicts = notUsed;
  concludeMerge = notUsed;
  abortMerge = notUsed;
  addWorktree = notUsed;
  checkoutDetached = notUsed;
  exportCommit = notUsed;
  removeWorktree = notUsed;
  commit = notUsed;
  committedPaths = notUsed;
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
  private readonly pipelines = new Map<string, PipelineCommands>([
    ["full", { name: "Full", keys: ["test"], broken: [] }],
    ["quick-fix", { name: "Quick fix", keys: [], broken: [] }],
    ["document", { name: "Document", keys: [], broken: [] }],
    ["thorough", { name: "Thorough", keys: ["test-full", "e2e"], broken: [] }],
    // Project Pipelines, their keys those of their built Stages.
    [
      "full-for-admin",
      { name: "Full for Admin panel", keys: ["lint"], projectId: "admin-panel", broken: [] },
    ],
    [
      "e2e-for-admin",
      { name: "Full with e2e", keys: ["e2e"], projectId: "admin-panel", broken: [] },
    ],
    [
      "spec-change",
      {
        name: "Spec change",
        keys: [],
        projectId: "admin-panel",
        broken: ["Changes Produce, which Document no longer has."],
      },
    ],
    ["full-for-shop", { name: "Full for Shop", keys: [], projectId: "shop", broken: [] }],
  ]);

  async commandsNamedBy(id: string): Promise<PipelineCommands | undefined> {
    return this.pipelines.get(id);
  }
}

/** The checks only read a Project's name, for the Project a Project Pipeline belongs to. */
class FakeProjects extends ProjectRepository {
  private readonly projects: readonly Project[] = [
    aProject(),
    aProject({ id: "shop", name: "Shop" }),
  ];

  async find(id: string): Promise<Project | undefined> {
    return this.projects.find((project) => project.id === id);
  }

  add = notUsed;
  list = notUsed;
  update = notUsed;
}

const OFFICE_DATA = resolve("/office-data");
const CLONE = join(OFFICE_DATA, "repositories", "github.com", "acme", "shop");

function checksWith(git: Git = new FakeGit()): ProjectChecks {
  return new ProjectChecks(
    git,
    new FakePipelines(),
    new OfficeDataDirectory(OFFICE_DATA),
    new EngineModels(new EngineSettingsForTests()),
    new FakeProjects(),
  );
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
    await expect(
      checksWith().checkDefaultPipeline(aProject({ defaultPipeline: "quick-fix" })),
    ).resolves.toBeUndefined();
    expect(
      await reasonsOf(checksWith().checkDefaultPipeline(aProject({ defaultPipeline: "nightly" }))),
    ).toEqual(['There is no Pipeline "nightly".']);
  });

  it("refuses a Pipeline running commands the Project lacks, naming each, and passes one it has, blank or not", async () => {
    const blankTest = startingCommands().map((command) =>
      command.key === "test" ? { ...command, commandLine: "" } : command,
    );

    expect(
      await reasonsOf(checksWith().checkDefaultPipeline(aProject({ defaultPipeline: "thorough" }))),
    ).toEqual([
      "The Pipeline Thorough runs test-full and e2e, which Admin panel has no commands for. Add them to the Project's commands, or choose another default Pipeline.",
    ]);
    await expect(
      checksWith().checkDefaultPipeline(aProject({ commands: blankTest })),
    ).resolves.toBeUndefined();
  });

  it("passes one of the Project's own Project Pipelines", async () => {
    await expect(
      checksWith().checkDefaultPipeline(aProject({ defaultPipeline: "full-for-admin" })),
    ).resolves.toBeUndefined();
  });

  it("refuses another Project's Project Pipeline and a Broken one of its own, naming why", async () => {
    expect(
      await reasonsOf(
        checksWith().checkDefaultPipeline(aProject({ defaultPipeline: "full-for-shop" })),
      ),
    ).toEqual([
      "Full for Shop is a Project Pipeline of Shop: only Shop's Tasks and default can follow it.",
    ]);
    expect(
      await reasonsOf(
        checksWith().checkDefaultPipeline(aProject({ defaultPipeline: "spec-change" })),
      ),
    ).toEqual([
      "Spec change is Broken: Changes Produce, which Document no longer has. A Broken Pipeline can't be the default: fix its Stage changes in Admin panel's Pipelines first, or choose another default Pipeline.",
    ]);
  });

  it("refuses a Project Pipeline whose built Stages run a command the Project lacks", async () => {
    expect(
      await reasonsOf(
        checksWith().checkDefaultPipeline(aProject({ defaultPipeline: "e2e-for-admin" })),
      ),
    ).toEqual([
      "The Pipeline Full with e2e runs e2e, which Admin panel has no command for. Add it to the Project's commands, or choose another default Pipeline.",
    ]);
  });

  it("refuses a Project Pipeline as a new Project's default, office-wide ones only", async () => {
    const newProject = aNewProject({ defaultPipeline: "full-for-admin" });

    expect(await checksWith().newCloneProblems(newProject)).toEqual([
      "Full for Admin panel is a Project Pipeline of Admin panel; a new Project's default Pipeline is an office-wide one.",
    ]);
    expect(await reasonsOf(checksWith().checkNewProject(newProject))).toEqual([
      "Full for Admin panel is a Project Pipeline of Admin panel; a new Project's default Pipeline is an office-wide one.",
    ]);
  });

  it("refuses adding a Project whose default Pipeline runs a command it lacks", async () => {
    const newProject = aNewProject({ defaultPipeline: "thorough" });

    expect(await checksWith().newCloneProblems(newProject)).toEqual([
      "The Pipeline Thorough runs test-full and e2e, which Admin panel has no commands for. Add them to the Project's commands, or choose another default Pipeline.",
    ]);
  });
});

describe("ProjectChecks.checkCommandRemoval", () => {
  it("refuses removing a command the default Pipeline runs, and passes any other", async () => {
    expect(await reasonsOf(checksWith().checkCommandRemoval(aProject(), "test"))).toEqual([
      "Full, this Project's default Pipeline, runs test; choose another default first.",
    ]);
    await expect(checksWith().checkCommandRemoval(aProject(), "lint")).resolves.toBeUndefined();
  });

  it("refuses removing a command its own Project Pipeline, as the default, runs in its built Stages", async () => {
    const project = aProject({ defaultPipeline: "full-for-admin" });

    expect(await reasonsOf(checksWith().checkCommandRemoval(project, "lint"))).toEqual([
      "Full for Admin panel, this Project's default Pipeline, runs lint; choose another default first.",
    ]);
    await expect(checksWith().checkCommandRemoval(project, "test")).resolves.toBeUndefined();
  });

  it("refuses removing a command a Kind's own default Pipeline runs, naming its Kinds", async () => {
    const project = aProject({
      kindDefaultPipelines: { feature: "full", bug: "thorough", chore: "thorough" },
    });

    expect(await reasonsOf(checksWith().checkCommandRemoval(project, "e2e"))).toEqual([
      "Thorough, this Project's default Pipeline for Bugs and Chores, runs e2e; choose another default for Bugs and Chores first.",
    ]);
    // A Kind following the default Pipeline names it once, as the Project's.
    expect(await reasonsOf(checksWith().checkCommandRemoval(project, "test"))).toEqual([
      "Full, this Project's default Pipeline, runs test; choose another default first.",
    ]);
  });

  it("lets a command go that only another Project's Pipeline, as a Kind's default, runs", async () => {
    const project = aProject({
      kindDefaultPipelines: { feature: null, bug: "e2e-for-admin", chore: null },
    });

    await expect(
      checksWith().checkCommandRemoval({ ...project, id: "shop" }, "e2e"),
    ).resolves.toBeUndefined();
    expect(await reasonsOf(checksWith().checkCommandRemoval(project, "e2e"))).toEqual([
      "Full with e2e, this Project's default Pipeline for Bugs, runs e2e; choose another default for Bugs first.",
    ]);
  });
});

describe("ProjectChecks.checkProjectEngine", () => {
  const engineId = FIRST_CLAUDE_CODE_ENGINE.id;
  const NONE = {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: [] },
  } as const;
  const onClaude = { engineType: "claude-code", engineId } as const;

  it("passes a listed engine of its type with a force and people's settings its types offer", async () => {
    await expect(
      checksWith().checkProjectEngine(
        {
          ...NONE,
          default: onClaude,
          force: { model: "claude-haiku-5-5", effort: "max" },
          people: [
            { roleKey: "cto", engineSettings: { "claude-code": { model: null, effort: "low" } } },
          ],
        },
        NONE,
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses an engine Settings › Engines doesn't list, or one of another type than the default's", async () => {
    expect(
      await reasonsOf(
        checksWith().checkProjectEngine(
          { ...NONE, default: { engineType: "claude-code", engineId: "gone" } },
          NONE,
        ),
      ),
    ).toEqual(['There is no engine "gone".']);
    expect(
      await reasonsOf(
        checksWith().checkProjectEngine(
          { ...NONE, default: { engineType: "codex", engineId } },
          NONE,
        ),
      ),
    ).toEqual(["Claude Code isn't a Codex account."]);
  });

  it("refuses a forced or a person's model or effort the type doesn't offer", async () => {
    expect(
      await reasonsOf(
        checksWith().checkProjectEngine(
          { ...NONE, default: onClaude, force: { model: "gpt-oss", effort: null } },
          NONE,
        ),
      ),
    ).toEqual(["Choose a model Claude Code offers."]);
    expect(
      await reasonsOf(
        checksWith().checkProjectEngine(
          {
            ...NONE,
            people: [
              { roleKey: "cto", engineSettings: { codex: { model: "gpt-5.5", effort: "max" } } },
            ],
          },
          NONE,
        ),
      ),
    ).toEqual(["Choose a model Codex offers.", "Choose an effort Codex takes."]);
  });

  it("refuses a changed Stand-in Engine list naming an engine not listed or one twice, used or not", async () => {
    expect(
      await reasonsOf(
        checksWith().checkProjectEngine(
          { ...NONE, standIns: { useOwnList: false, engineIds: ["gone", engineId, engineId] } },
          NONE,
        ),
      ),
    ).toEqual([
      "Pick each Stand-in Engine among the engines listed.",
      '"Claude Code" is listed twice as a Stand-in Engine.',
    ]);
  });

  it("passes a Stand-in Engine list as it is stored", async () => {
    const standIns = { useOwnList: true, engineIds: ["gone"] };

    await expect(
      checksWith().checkProjectEngine({ ...NONE, standIns }, { ...NONE, standIns }),
    ).resolves.toBeUndefined();
  });

  it("passes a person's setting for a type as it is stored, though no engine of the type is listed", async () => {
    const people = [
      { roleKey: "cto", engineSettings: { codex: { model: "gpt-5.5", effort: "high" } } },
    ] as const;

    await expect(
      checksWith().checkProjectEngine({ ...NONE, people }, { ...NONE, people }),
    ).resolves.toBeUndefined();
  });
});
