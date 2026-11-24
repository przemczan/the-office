import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepositoryFiles } from "../ports/repository-files.js";
import { RunEnvironmentDefinitions } from "./run-environment-definitions.js";

const DEVCONTAINER = `{
  // The checks run in "app"; Postgres beside it.
  "dockerComposeFile": ["compose.yaml"],
  "service": "app",
}`;

const COMPOSE = `
services:
  app:
    image: node:22
    command: sleep infinity
  postgres:
    image: postgres:17
`;

/**
 * The Task's worktree's git, as Projects answers it: what is uncommitted, the commits made, and the
 * folders put back, with nothing committed yet in the worktree.
 */
class WorktreeGit extends RepositoryFiles {
  uncommitted: string[] = [];
  readonly commits: { worktree: string; folder: string; message: string }[] = [];
  readonly restored: { worktree: string; folder: string }[] = [];
  commitFails: Error | undefined;

  async uncommittedPathsUnder(): Promise<readonly string[]> {
    return this.uncommitted;
  }

  async commitFolder(worktree: string, folder: string, message: string): Promise<string> {
    if (this.commitFails) throw this.commitFails;
    this.commits.push({ worktree, folder, message });
    return "c0ffee";
  }

  async restoreFolder(worktree: string, folder: string): Promise<void> {
    this.restored.push({ worktree, folder });
    await rm(join(worktree, folder), { recursive: true, force: true });
  }

  lastFetchedBase = notUsed;
  freshBase = notUsed;
  taskBranchTip = notUsed;
  taskForkPoint = notUsed;
  textAt = notUsed;
}

function notUsed(): never {
  throw new Error("Not used by the definition's writing.");
}

let git: WorktreeGit;
let definitions: RunEnvironmentDefinitions;

let worktree: string;

beforeEach(async () => {
  worktree = await mkdtemp(join(tmpdir(), "office-definition-"));
  git = new WorktreeGit();
  definitions = new RunEnvironmentDefinitions(git);
});

afterEach(async () => {
  await rm(worktree, { recursive: true, force: true });
});

async function definitionFolderFiles(): Promise<string[]> {
  return (await readdir(join(worktree, ".devcontainer")).catch(() => [])).toSorted();
}

describe("RunEnvironmentDefinitions.write", () => {
  it("writes a valid definition into .devcontainer/, leaving the folder's other files, and names the checks' service", async () => {
    await mkdir(join(worktree, ".devcontainer"));
    await writeFile(join(worktree, ".devcontainer", "Dockerfile"), "FROM node:22\n");

    const writing = await definitions.write(worktree, [
      { path: ".devcontainer/devcontainer.json", text: DEVCONTAINER },
      { path: "./.devcontainer/compose.yaml", text: COMPOSE },
    ]);

    expect(writing).toEqual({
      written: true,
      paths: [".devcontainer/devcontainer.json", ".devcontainer/compose.yaml"],
      service: "app",
    });
    await expect(readFile(join(worktree, ".devcontainer", "compose.yaml"), "utf8")).resolves.toBe(
      COMPOSE,
    );
    expect(await definitionFolderFiles()).toEqual([
      "Dockerfile",
      "compose.yaml",
      "devcontainer.json",
    ]);
  });

  it("reads a file the definition names but isn't given from the worktree", async () => {
    await mkdir(join(worktree, ".devcontainer"));
    await writeFile(join(worktree, ".devcontainer", "compose.yaml"), COMPOSE);

    const writing = await definitions.write(worktree, [
      { path: ".devcontainer/devcontainer.json", text: DEVCONTAINER },
    ]);

    expect(writing).toMatchObject({ written: true, service: "app" });
  });

  it("writes nothing for a definition with problems, and answers every one in readDefinition's words", async () => {
    const writing = await definitions.write(worktree, [
      {
        path: ".devcontainer/devcontainer.json",
        text: `{ "dockerComposeFile": ["compose.yaml"], "service": "app", "forwardPorts": [3000] }`,
      },
    ]);

    expect(writing).toEqual({
      written: false,
      problems: [`devcontainer.json sets "forwardPorts", which The Office doesn't support.`],
    });
    expect(await definitionFolderFiles()).toEqual([]);
  });

  it("writes nothing without a devcontainer.json, given or in the worktree", async () => {
    const writing = await definitions.write(worktree, [
      { path: ".devcontainer/compose.yaml", text: COMPOSE },
    ]);

    expect(writing).toEqual({
      written: false,
      problems: ["The repository has no .devcontainer/devcontainer.json."],
    });
    expect(await definitionFolderFiles()).toEqual([]);
  });

  it("refuses a path outside .devcontainer/, writing none of the files", async () => {
    const writing = await definitions.write(worktree, [
      { path: ".devcontainer/devcontainer.json", text: DEVCONTAINER },
      { path: ".devcontainer/compose.yaml", text: COMPOSE },
      { path: ".devcontainer/../package.json", text: "{}" },
    ]);

    expect(writing).toEqual({
      written: false,
      problems: [
        ".devcontainer/../package.json is outside .devcontainer/: give each file's path from the repository's root, inside .devcontainer/, such as .devcontainer/devcontainer.json.",
      ],
    });
    expect(await definitionFolderFiles()).toEqual([]);
    await expect(readFile(join(worktree, "package.json"), "utf8")).rejects.toThrow(/ENOENT/);
  });
});

describe("RunEnvironmentDefinitions.writeAndCommit", () => {
  const files = [
    { path: ".devcontainer/devcontainer.json", text: DEVCONTAINER },
    { path: ".devcontainer/compose.yaml", text: COMPOSE },
  ];

  it("writes a valid definition, then commits only .devcontainer/ with the message", async () => {
    const commit = await definitions.writeAndCommit(worktree, files, "Add the run environment");

    expect(commit).toEqual({
      written: true,
      service: "app",
      paths: [".devcontainer/devcontainer.json", ".devcontainer/compose.yaml"],
      commit: "c0ffee",
    });
    expect(git.commits).toEqual([
      { worktree, folder: ".devcontainer", message: "Add the run environment" },
    ]);
    expect(await definitionFolderFiles()).toEqual(["compose.yaml", "devcontainer.json"]);
  });

  it("refuses while .devcontainer/ has changes not committed yet, writing and committing nothing", async () => {
    await mkdir(join(worktree, ".devcontainer"));
    await writeFile(join(worktree, ".devcontainer", "notes.md"), "Someone's own\n");
    git.uncommitted = [".devcontainer/notes.md"];

    const commit = await definitions.writeAndCommit(worktree, files, "Add the run environment");

    expect(commit).toEqual({
      written: false,
      problems: [
        ".devcontainer/ has changes not committed yet that this write didn't make (.devcontainer/notes.md); the write is refused until the Stage commits them or they are discarded.",
      ],
    });
    expect(await definitionFolderFiles()).toEqual(["notes.md"]);
    expect(git.commits).toEqual([]);
  });

  it("puts .devcontainer/ back as committed when the commit fails, and throws, so the next call isn't refused", async () => {
    git.commitFails = new Error("Committing is not possible because you have unmerged files.");

    await expect(
      definitions.writeAndCommit(worktree, files, "Add the run environment"),
    ).rejects.toThrow(/unmerged files/);

    expect(git.restored).toEqual([{ worktree, folder: ".devcontainer" }]);
    expect(await definitionFolderFiles()).toEqual([]);
    git.commitFails = undefined;
    await expect(
      definitions.writeAndCommit(worktree, files, "Add the run environment"),
    ).resolves.toMatchObject({ written: true, commit: "c0ffee" });
  });

  it("writes and commits nothing for a definition with problems", async () => {
    const commit = await definitions.writeAndCommit(
      worktree,
      [
        {
          path: ".devcontainer/devcontainer.json",
          text: `{ "dockerComposeFile": "compose.yaml" }`,
        },
      ],
      "Add the run environment",
    );

    expect(commit).toMatchObject({
      written: false,
      problems: expect.arrayContaining([expect.stringMatching(/names no service/)]),
    });
    expect(await definitionFolderFiles()).toEqual([]);
    expect(git.commits).toEqual([]);
  });
});
