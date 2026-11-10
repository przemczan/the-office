import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const definitions = new RunEnvironmentDefinitions();

let worktree: string;

beforeEach(async () => {
  worktree = await mkdtemp(join(tmpdir(), "office-definition-"));
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
