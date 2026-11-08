import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { officeIdentityForTests } from "../../../platform/git-identity/office-identity.fixtures.js";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { CommandLineGit } from "../adapters/git/command-line-git.js";
import { GitProcess } from "../adapters/git/git-process.js";
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
import type { Project } from "../domain/project.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { BaseBranchFiles, FOLDER_ENTRIES_LIMIT } from "./base-branch-files.js";
import { ProjectCommandRunner } from "./project-command-runner.js";
import { ProjectRemotes } from "./project-remotes.js";
import type { ProjectService } from "./project-service.js";
import { Worktrees } from "./worktrees.js";
import { taskCommandsOver } from "./task-command-runner.fixtures.js";

const NO_SUCH_COMMIT = "0123456789abcdef0123456789abcdef01234567";
/** A PNG's signature, then bytes that are no UTF-8: a decoded copy would come back different. */
const BINARY = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80,
]);
const LATER_BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xc0, 0xaf]);
const LIMIT = { bytes: BINARY.byteLength, problem: "That is too much." };

let repository: TemporaryRepository;
let files: BaseBranchFiles;
let project: Project;
let commit: string;
let imageCommit: string;
let laterImageCommit: string;

/** Adds an entry of the given mode to the index without a file behind it, as a link or submodule is. */
function addToIndex(path: string, mode: string, object: string): void {
  gitIn(repository.path, "update-index", "--add", "--cacheinfo", `${mode},${object},${path}`);
}

function blobOf(text: string): string {
  return execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repository.path,
    input: text,
    encoding: "utf8",
  }).trim();
}

/** Commits a folder of `count` files and `folders` folders in one go, then pushes it. */
function commitCrowdedFolder(name: string, count: number, folders: number): void {
  const blob = blobOf("crowded");
  const lines = [
    ...Array.from({ length: count }, (_, index) => `100644 ${blob}\t${name}/a-${index}.txt`),
    ...Array.from({ length: folders }, (_, index) => `100644 ${blob}\t${name}/z-${index}/f.txt`),
  ];
  execFileSync("git", ["update-index", "--add", "--index-info"], {
    cwd: repository.path,
    input: `${lines.join("\n")}\n`,
  });
  gitIn(repository.path, "commit", "--quiet", "--message", `Add ${name}`);
}

/** Commits everything in the working tree with `file` holding `content`, answering the commit. */
async function commitFile(file: string, content: Buffer): Promise<string> {
  await writeFile(join(repository.path, file), content);
  gitIn(repository.path, "add", ".");
  gitIn(repository.path, "commit", "--quiet", "--message", `Commit ${file}`);
  return gitIn(repository.path, "rev-parse", "HEAD");
}

function filesFor(read: Project): BaseBranchFiles {
  const officeData = join(repository.folder, "office-data");
  const identity = officeIdentityForTests(officeData);
  const git = new CommandLineGit(new RepositoryLocks(), identity);
  const commands = new ProjectCommandRunner(new ShellCommandRunner());
  return new BaseBranchFiles(
    { read: () => Promise.resolve(read) } as unknown as ProjectService,
    git,
    new Worktrees(git, commands, taskCommandsOver(commands), new OfficeDataDirectory(officeData)),
    commands,
    new ProjectRemotes(git, identity),
  );
}

beforeAll(async () => {
  repository = await createTemporaryRepository();
  const { path } = repository;
  await mkdir(join(path, "assets", "icons"), { recursive: true });
  await writeFile(join(path, "assets", "logo.PNG"), "logo");
  await writeFile(join(path, "assets", "icon.svg"), "icon");
  await writeFile(join(path, "assets", "notes.md"), "notes");
  await writeFile(join(path, "assets", "icons", "a.png"), "a");
  gitIn(path, "add", ".");
  addToIndex("assets/link.png", "120000", blobOf("logo.PNG"));
  addToIndex("assets/module.png", "160000", gitIn(path, "rev-parse", "HEAD"));
  gitIn(path, "commit", "--quiet", "--message", "The assets");
  commitCrowdedFolder("crowded", FOLDER_ENTRIES_LIMIT + 5, 3);
  gitIn(path, "push", "--quiet", "origin", "main");
  gitIn(path, "fetch", "--quiet", "origin");
  gitIn(path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");

  // What must not show: another branch's file, a commit not pushed, and what isn't committed.
  gitIn(path, "checkout", "--quiet", "-b", "other");
  await writeFile(join(path, "other-branch.txt"), "other");
  gitIn(path, "add", ".");
  gitIn(path, "commit", "--quiet", "--message", "On another branch");
  imageCommit = await commitFile("picture.png", BINARY);
  await writeFile(join(path, "over-the-limit.png"), Buffer.concat([BINARY, Buffer.of(0)]));
  laterImageCommit = await commitFile("picture.png", LATER_BINARY);
  gitIn(path, "checkout", "--quiet", "main");
  await writeFile(join(path, "local-commit.txt"), "not pushed");
  gitIn(path, "add", ".");
  gitIn(path, "commit", "--quiet", "--message", "Not pushed");
  await writeFile(join(path, "staged.txt"), "staged");
  gitIn(path, "add", "staged.txt");
  await writeFile(join(path, "untracked.txt"), "untracked");

  project = aProject({ path, baseBranch: "main" });
  files = filesFor(project);
  ({ commit } = await files.fresh(project.id));
}, REAL_GIT_TEST.timeout);

afterAll(async () => {
  await repository.remove();
});

function namesOf(folder: { entries: readonly { name: string }[] }): string[] {
  return folder.entries.map(({ name }) => name);
}

async function refusalOf(commitId: string, path: string): Promise<string[]> {
  const error: unknown = await files
    .folder(project.id, commitId, path, [])
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProjectRefused);
  return [...(error as ProjectRefused).reasons];
}

async function fileRefusalOf(commitId: string, path: string): Promise<string[]> {
  const error: unknown = await files
    .file(project.id, commitId, path, LIMIT)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProjectRefused);
  return [...(error as ProjectRefused).reasons];
}

describe("BaseBranchFiles.fresh", REAL_GIT_TEST, () => {
  it("answers the upstream's commit with no problem", async () => {
    await expect(files.fresh(project.id)).resolves.toEqual({
      commit: gitIn(repository.originPath, "rev-parse", "main"),
      fetchProblem: undefined,
    });
  });

  it("shows a commit that reached the upstream, in the commit fetched after it", async () => {
    const moved = await commitOnOrigin(repository, "main", "from-origin.txt");
    const fresh = await files.fresh(project.id);

    expect(fresh.commit).toBe(moved);
    expect(namesOf(await files.folder(project.id, moved, "", []))).toContain("from-origin.txt");
    expect(namesOf(await files.folder(project.id, commit, "", []))).not.toContain(
      "from-origin.txt",
    );
  });

  it("answers the last commit known here, and why, when the fetch fails", async () => {
    const known = gitIn(repository.path, "rev-parse", "refs/remotes/origin/main");
    const url = gitIn(repository.path, "remote", "get-url", "origin");
    gitIn(repository.path, "remote", "set-url", "origin", join(repository.folder, "gone.git"));
    try {
      const fresh = await files.fresh(project.id);

      expect(fresh.commit).toBe(known);
      expect(fresh.fetchProblem).toContain("gone.git");
    } finally {
      gitIn(repository.path, "remote", "set-url", "origin", url);
    }
  });

  it("answers the local base branch when it tracks nothing", async () => {
    const local = aProject({ path: repository.path, baseBranch: "other" });

    await expect(filesFor(local).fresh(local.id)).resolves.toEqual({
      commit: gitIn(repository.path, "rev-parse", "other"),
      fetchProblem: undefined,
    });
  });

  it("refuses when the workstation knows no commit of the base branch", async () => {
    const gone = aProject({ path: join(repository.folder, "not-here"), baseBranch: "main" });

    await expect(filesFor(gone).fresh(gone.id)).rejects.toBeInstanceOf(ProjectRefused);
  });
});

describe("BaseBranchFiles.folder", REAL_GIT_TEST, () => {
  it("lists only what is committed on the base branch, folders first", async () => {
    const folder = await files.folder(project.id, commit, "", []);

    expect(namesOf(folder)).toEqual(["assets", "crowded", "src"]);
    expect(folder.total).toBe(3);
    expect(folder.commit).toBe(commit);
  });

  it("reads one folder, without what the folders in it hold", async () => {
    const folder = await files.folder(project.id, commit, "assets", []);

    expect(folder.entries).toEqual([
      { name: "icons", kind: "folder" },
      { name: "icon.svg", kind: "file" },
      { name: "logo.PNG", kind: "file" },
      { name: "notes.md", kind: "file" },
    ]);
  });

  it("leaves out links and submodules, even with a matching name", async () => {
    const names = namesOf(await files.folder(project.id, commit, "assets", ["png"]));

    expect(names).not.toContain("link.png");
    expect(names).not.toContain("module.png");
  });

  it("filters files by extension in any case, always showing folders", async () => {
    expect(namesOf(await files.folder(project.id, commit, "assets", ["png", ".SVG"]))).toEqual([
      "icons",
      "icon.svg",
      "logo.PNG",
    ]);
    expect(namesOf(await files.folder(project.id, commit, "assets", ["gif"]))).toEqual(["icons"]);
  });

  it("cuts a crowded folder, keeping folders first and telling the total", async () => {
    const folder = await files.folder(project.id, commit, "crowded", []);

    expect(folder.entries).toHaveLength(FOLDER_ENTRIES_LIMIT);
    expect(folder.total).toBe(FOLDER_ENTRIES_LIMIT + 5 + 3);
    expect(folder.entries.slice(0, 3).map(({ kind }) => kind)).toEqual([
      "folder",
      "folder",
      "folder",
    ]);
    expect(folder.entries[3]?.kind).toBe("file");
  });

  it("refuses a commit that isn't an id or that the repository doesn't hold", async () => {
    await expect(refusalOf("main", "")).resolves.toEqual(["The repository holds no commit main."]);
    await expect(refusalOf("HEAD~1", "")).resolves.toHaveLength(1);
    await expect(refusalOf(NO_SUCH_COMMIT, "")).resolves.toEqual([
      `The repository holds no commit ${NO_SUCH_COMMIT}.`,
    ]);
    await expect(
      refusalOf(gitIn(repository.path, "rev-parse", "HEAD:src"), ""),
    ).resolves.toHaveLength(1);
  });

  it.each([
    "/etc",
    "\\etc",
    "C:\\etc",
    "..",
    "../..",
    "assets/..",
    "assets/../..",
    ".",
    "./assets",
  ])("refuses the path %s, which leaves the repository's folders", async (path) => {
    await expect(refusalOf(commit, path)).resolves.toHaveLength(1);
  });

  it.each(["assets//icons", "assets/", "a\0b"])("refuses the malformed path %j", async (path) => {
    await expect(refusalOf(commit, path)).resolves.toHaveLength(1);
  });

  it.each([
    ["no such name", "nothing-here"],
    ["a file", "assets/notes.md"],
    ["a link", "assets/link.png"],
    ["a submodule", "assets/module.png"],
    ["words git would read as its own", ":(top)assets"],
    ["magic git doesn't know", ":(nonsense)"],
    ["a wildcard", "asse*"],
  ])("refuses a path naming %s", async (_, path) => {
    await expect(refusalOf(commit, path)).resolves.toEqual([
      `The repository has no folder ${path} at this commit.`,
    ]);
  });
});

describe("BaseBranchFiles.file", REAL_GIT_TEST, () => {
  it("answers a file's bytes as committed, for one that is no text too", async () => {
    const bytes = await files.file(project.id, imageCommit, "picture.png", LIMIT);

    expect(Buffer.from(bytes).equals(BINARY)).toBe(true);
  });

  it("reads the commit picked, not a later one", async () => {
    const later = await files.file(project.id, laterImageCommit, "picture.png", LIMIT);

    expect(Buffer.from(later).equals(LATER_BINARY)).toBe(true);
    await expect(files.file(project.id, imageCommit, "picture.png", LIMIT)).resolves.toHaveLength(
      BINARY.byteLength,
    );
  });

  it("reads a file in a folder", async () => {
    const bytes = await files.file(project.id, commit, "assets/icons/a.png", LIMIT);

    expect(Buffer.from(bytes).toString()).toBe("a");
  });

  it("refuses a file over the limit in the caller's words, without reading it", async () => {
    const reading = vi.spyOn(GitProcess.prototype, "bytes");
    try {
      await expect(fileRefusalOf(laterImageCommit, "over-the-limit.png")).resolves.toEqual([
        LIMIT.problem,
      ]);
      const commands = reading.mock.calls.map(([{ gitArguments }]) => gitArguments.join(" "));
      expect(commands.filter((command) => command.startsWith("cat-file blob"))).toEqual([]);
    } finally {
      reading.mockRestore();
    }
  });

  it("answers what git holds for a link, the target's path, not the target", async () => {
    const bytes = await files.file(project.id, commit, "assets/link.png", LIMIT);

    expect(Buffer.from(bytes).toString()).toBe("logo.PNG");
  });

  it("refuses a commit that isn't an id or that the repository doesn't hold", async () => {
    await expect(fileRefusalOf("main", "assets/logo.PNG")).resolves.toEqual([
      "The repository holds no commit main.",
    ]);
    await expect(fileRefusalOf(NO_SUCH_COMMIT, "assets/logo.PNG")).resolves.toEqual([
      `The repository holds no commit ${NO_SUCH_COMMIT}.`,
    ]);
  });

  it.each(["/etc/passwd", "\\etc", "C:\\etc", "../secret.png", "assets/../..", "./a", "a\0b"])(
    "refuses the path %j, which no commit can hold",
    async (path) => {
      await expect(fileRefusalOf(commit, path)).resolves.toHaveLength(1);
    },
  );

  it.each([
    ["the top level", ""],
    ["no such name", "nothing-here.png"],
    ["a folder", "assets"],
    ["a submodule", "assets/module.png"],
    ["words git would read as its own", ":(top)assets/logo.PNG"],
    ["a wildcard", "assets/*.PNG"],
  ])("refuses a path naming %s", async (_, path) => {
    await expect(fileRefusalOf(commit, path)).resolves.toEqual([
      `The repository has no file ${path} at this commit.`,
    ]);
  });

  it("refuses a file the commit picked doesn't hold, though a later one does", async () => {
    await expect(fileRefusalOf(imageCommit, "over-the-limit.png")).resolves.toHaveLength(1);
  });
});
