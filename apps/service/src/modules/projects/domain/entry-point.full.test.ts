import { describe, expect, it } from "vitest";
import {
  entryPointProblems,
  pathInRepository,
  type EntryPoint,
  type EntryPointTree,
} from "./entry-point.js";
import { ProjectRefused } from "./project-refused.js";

function treeOf(
  files: Readonly<Record<string, string>>,
  services?: readonly string[],
): EntryPointTree {
  return {
    isFile: async (path) => path in files,
    textAt: async (path) => {
      if (path === "huge.json")
        throw new ProjectRefused([`${path} is over 1 MB, too large to read.`]);
      return files[path];
    },
    devcontainerServices: async () => services,
  };
}

const TREE = treeOf(
  {
    "scripts/start.sh": "#!/bin/sh\n",
    "package.json": JSON.stringify({ scripts: { start: "vite" } }),
    "bad.json": "{",
    "no-scripts.json": "{}",
    gradlew: "#!/bin/sh\n",
  },
  ["app"],
);

async function problemsOf(entryPoint: EntryPoint, tree = TREE): Promise<string[]> {
  return entryPointProblems(entryPoint, tree);
}

describe("pathInRepository", () => {
  it("normalises a path inside the repository and refuses one leaving it", () => {
    expect(pathInRepository("./scripts//start.sh")).toBe("scripts/start.sh");
    expect(pathInRepository("scripts\\start.sh")).toBe("scripts/start.sh");
    expect(pathInRepository("a/../b")).toBe("b");
    expect(pathInRepository("a/../../b")).toBeUndefined();
    expect(pathInRepository("/etc/passwd")).toBeUndefined();
    expect(pathInRepository("C:/tools/run.cmd")).toBeUndefined();
  });
});

describe("entryPointProblems", () => {
  it("passes a file there, a script the manifest lists, a task with the wrapper and a service", async () => {
    expect(
      await problemsOf({ kind: "repository-file", path: "./scripts/start.sh", arguments: ["-v"] }),
    ).toEqual([]);
    expect(
      await problemsOf({
        kind: "package-script",
        manifest: "package.json",
        script: "start",
        arguments: [],
      }),
    ).toEqual([]);
    expect(
      await problemsOf({ kind: "gradle-task", task: ":app:assembleDebug", arguments: [] }),
    ).toEqual([]);
    expect(await problemsOf({ kind: "devcontainer-service", service: "app" })).toEqual([]);
  });

  it("refuses what the commit doesn't hold, in words naming it", async () => {
    expect(
      await problemsOf({ kind: "repository-file", path: "scripts/stop.sh", arguments: [] }),
    ).toEqual(["The repository has no file scripts/stop.sh."]);
    expect(
      await problemsOf({
        kind: "package-script",
        manifest: "web/package.json",
        script: "start",
        arguments: [],
      }),
    ).toEqual(["The repository has no package manifest web/package.json."]);
    expect(
      await problemsOf({
        kind: "package-script",
        manifest: "bad.json",
        script: "start",
        arguments: [],
      }),
    ).toEqual(["The package manifest bad.json isn't valid JSON."]);
    expect(
      await problemsOf({
        kind: "package-script",
        manifest: "no-scripts.json",
        script: "start",
        arguments: [],
      }),
    ).toEqual([`The package manifest no-scripts.json has no script start in its "scripts".`]);
    expect(
      await problemsOf({
        kind: "package-script",
        manifest: "huge.json",
        script: "start",
        arguments: [],
      }),
    ).toEqual(["huge.json is over 1 MB, too large to read."]);
    expect(
      await problemsOf({ kind: "gradle-task", task: "assembleDebug", arguments: [] }, treeOf({})),
    ).toEqual([
      "The repository has no Gradle wrapper, gradlew, at its root, which a Gradle task runs through.",
    ]);
    expect(await problemsOf({ kind: "devcontainer-service", service: "app" }, treeOf({}))).toEqual([
      "The repository has no .devcontainer/ definition that can be read, so it has no service app.",
    ]);
  });

  it("refuses inline shell and paths leaving the repository before reading anything", async () => {
    expect(
      await problemsOf({ kind: "gradle-task", task: "build && rm -rf /", arguments: [] }),
    ).toEqual([
      `"build && rm -rf /" isn't a Gradle task: give its name, such as assembleDebug or :app:assembleDebug.`,
    ]);
    expect(await problemsOf({ kind: "gradle-task", task: "--init-script", arguments: [] })).toEqual(
      [
        `"--init-script" isn't a Gradle task: give its name, such as assembleDebug or :app:assembleDebug.`,
      ],
    );
    expect(
      await problemsOf({ kind: "repository-file", path: "../../bin/sh", arguments: ["a\nb"] }),
    ).toEqual([
      "The path of the file, ../../bin/sh, must be inside the repository, from its root.",
      "Each argument must be one line.",
    ]);
    expect(
      await problemsOf({ kind: "package-script", manifest: "", script: "", arguments: [] }),
    ).toEqual(["Give the path of the package manifest.", "Name the package script."]);
  });
});
