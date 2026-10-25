import { describe, expect, it } from "vitest";
import { linux } from "./linux.js";

const homeDirectory = "/home/office";

/** A path of short names, exactly this many bytes long. */
const pathOfLength = (length: number): string => `/${"a/".repeat(length / 2)}`.slice(0, length);

describe("linux", () => {
  describe("defaultOfficeDataDirectory", () => {
    it("is the-office in $XDG_DATA_HOME", () => {
      const { defaultOfficeDataDirectory } = linux({
        variables: { XDG_DATA_HOME: "/data/office" },
        homeDirectory,
      });

      expect(defaultOfficeDataDirectory).toBe("/data/office/the-office");
    });

    it.each([
      ["unset", undefined],
      ["blank", ""],
      ["relative", "data/office"],
    ])("falls back to ~/.local/share when XDG_DATA_HOME is %s", (_, value) => {
      const { defaultOfficeDataDirectory } = linux({
        variables: { XDG_DATA_HOME: value },
        homeDirectory,
      });

      expect(defaultOfficeDataDirectory).toBe("/home/office/.local/share/the-office");
    });
  });

  describe("paths", () => {
    const { paths } = linux({ variables: {}, homeDirectory });

    it("joins with forward slashes", () => {
      expect(paths.join("/office", "worktrees/project", "task")).toBe(
        "/office/worktrees/project/task",
      );
    });

    it("separates PATH entries with a colon", () => {
      expect(paths.pathListSeparator).toBe(":");
    });

    it.each(["file", "directory"] as const)("lets a %s path be at most 4095 bytes", (entry) => {
      expect(paths.lengthProblem(pathOfLength(4095), entry)).toBeUndefined();
      expect(paths.lengthProblem(pathOfLength(4096), entry)).toBe(
        `The path is 4096 bytes long; a ${entry} path may be at most 4095.`,
      );
    });

    it("lets a name be at most 255 bytes, counted in UTF-8", () => {
      expect(paths.lengthProblem(`/office/${"a".repeat(255)}`, "file")).toBeUndefined();
      expect(paths.lengthProblem(`/office/${"ż".repeat(128)}`, "file")).toMatch(
        /is 256 bytes long; a name in a path may be at most 255\.$/,
      );
    });
  });

  describe("defaultShell", () => {
    it("is /bin/sh, given the command line as one argument", () => {
      const { defaultShell } = linux({ variables: {}, homeDirectory });

      expect(defaultShell.name).toBe("sh");
      expect(defaultShell.invocation('npm run "test:unit"')).toEqual({
        file: "/bin/sh",
        arguments: ["-c", 'npm run "test:unit"'],
        windowsVerbatimArguments: false,
      });
    });
  });

  it("has Agents run commands in Bash alone", () => {
    expect(linux({ variables: {}, homeDirectory }).agentShells).toEqual(["bash"]);
  });

  describe("defaultShell.couldNotRun", () => {
    const { defaultShell } = linux({ variables: {}, homeDirectory });
    const failed = { commandLine: "gradle build", folder: "/work", environment: {} };

    it.each([126, 127])("knows sh could not run a command that exits with %i", async (code) => {
      await expect(defaultShell.couldNotRun({ ...failed, exitCode: code })).resolves.toBe(true);
    });

    it.each([1, 2, 128])("knows a command that exits with %i ran", async (code) => {
      await expect(defaultShell.couldNotRun({ ...failed, exitCode: code })).resolves.toBe(false);
    });
  });

  it("keeps variable names apart by case", () => {
    const { sameVariableName } = linux({ variables: {}, homeDirectory });

    expect(sameVariableName("PATH", "PATH")).toBe(true);
    expect(sameVariableName("Path", "PATH")).toBe(false);
  });
});
