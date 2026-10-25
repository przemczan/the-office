import { describe, expect, it } from "vitest";
import { programCandidates, programOf, windows } from "./windows.js";

const homeDirectory = "C:\\Users\\office";

/** A path of short names, exactly this many characters long. */
const pathOfLength = (length: number): string => `C:\\${"a\\".repeat(length / 2)}`.slice(0, length);

describe("windows", () => {
  describe("defaultOfficeDataDirectory", () => {
    it("is the-office in %LOCALAPPDATA%", () => {
      const { defaultOfficeDataDirectory } = windows({
        variables: { LOCALAPPDATA: "D:\\Profiles\\office\\AppData\\Local" },
        homeDirectory,
      });

      expect(defaultOfficeDataDirectory).toBe("D:\\Profiles\\office\\AppData\\Local\\the-office");
    });

    it.each([
      ["unset", undefined],
      ["blank", ""],
    ])("falls back to AppData\\Local in the home directory when LOCALAPPDATA is %s", (_, value) => {
      const { defaultOfficeDataDirectory } = windows({
        variables: { LOCALAPPDATA: value },
        homeDirectory,
      });

      expect(defaultOfficeDataDirectory).toBe("C:\\Users\\office\\AppData\\Local\\the-office");
    });
  });

  describe("paths", () => {
    const { paths } = windows({ variables: {}, homeDirectory });

    it("joins with backslashes and normalizes forward slashes", () => {
      expect(paths.join("C:\\office", "worktrees/project", "task")).toBe(
        "C:\\office\\worktrees\\project\\task",
      );
    });

    it("separates PATH entries with a semicolon", () => {
      expect(paths.pathListSeparator).toBe(";");
    });

    it.each([
      ["file", 259],
      ["directory", 247],
    ] as const)("lets a %s path be at most %i characters", (entry, maximum) => {
      expect(paths.lengthProblem(pathOfLength(maximum), entry)).toBeUndefined();
      expect(paths.lengthProblem(pathOfLength(maximum + 1), entry)).toBe(
        `The path is ${maximum + 1} characters long; a ${entry} path may be at most ${maximum}.`,
      );
    });

    it("counts UTF-16 characters, not bytes", () => {
      expect(paths.lengthProblem(`C:\\${"ż".repeat(200)}`, "file")).toBeUndefined();
    });

    it("lets a name be at most 255 characters, between either kind of slash", () => {
      expect(paths.lengthProblem(`C:\\${"a".repeat(255)}`, "file")).toBeUndefined();
      expect(paths.lengthProblem(`C:/${"a".repeat(256)}`, "file")).toMatch(
        /is 256 characters long; a name in a path may be at most 255\.$/,
      );
    });
  });

  describe("defaultShell", () => {
    it("is cmd.exe from %ComSpec%, given the command line verbatim in one pair of quotes", () => {
      const { defaultShell } = windows({
        variables: { ComSpec: "C:\\Windows\\system32\\cmd.exe" },
        homeDirectory,
      });

      expect(defaultShell.name).toBe("cmd.exe");
      expect(defaultShell.invocation('npm run "test:unit"')).toEqual({
        file: "C:\\Windows\\system32\\cmd.exe",
        arguments: ["/d", "/s", "/c", '"npm run "test:unit""'],
        windowsVerbatimArguments: true,
      });
    });

    it("falls back to cmd.exe in %SystemRoot%, then in C:\\Windows, never a bare name", () => {
      const fromSystemRoot = windows({ variables: { SystemRoot: "D:\\Windows" }, homeDirectory });
      const withNoVariables = windows({ variables: {}, homeDirectory });

      expect(fromSystemRoot.defaultShell.invocation("dir").file).toBe(
        "D:\\Windows\\System32\\cmd.exe",
      );
      expect(withNoVariables.defaultShell.invocation("dir").file).toBe(
        "C:\\Windows\\System32\\cmd.exe",
      );
    });
  });

  describe("defaultShell.couldNotRun", () => {
    const { defaultShell } = windows({ variables: {}, homeDirectory });

    it("knows a failing built-in command ran", async () => {
      await expect(
        defaultShell.couldNotRun({
          commandLine: "dir office-no-such-folder",
          exitCode: 1,
          folder: "C:\\work",
          environment: {},
        }),
      ).resolves.toBe(false);
    });
  });

  describe("programOf", () => {
    it.each([
      ["npm test", "npm"],
      ["  npx vitest run", "npx"],
      ['"C:\\Program Files\\nodejs\\node.exe" build.js', "C:\\Program Files\\nodejs\\node.exe"],
      ["gradlew&&echo done", "gradlew"],
      ["(npm ci)", undefined],
      ["", undefined],
    ])("reads the program of %j as cmd.exe does", (commandLine, program) => {
      expect(programOf(commandLine)).toBe(program);
    });
  });

  describe("programCandidates", () => {
    it("looks in the folder, then in each PATH folder, with each PATHEXT extension", () => {
      const candidates = programCandidates("npm", {
        folder: "C:\\work",
        environment: { Path: 'C:\\tools;"C:\\Program Files\\nodejs";', pathext: ".EXE;.CMD" },
      });

      expect(candidates).toEqual([
        "C:\\work\\npm",
        "C:\\work\\npm.EXE",
        "C:\\work\\npm.CMD",
        "C:\\tools\\npm",
        "C:\\tools\\npm.EXE",
        "C:\\tools\\npm.CMD",
        "C:\\Program Files\\nodejs\\npm",
        "C:\\Program Files\\nodejs\\npm.EXE",
        "C:\\Program Files\\nodejs\\npm.CMD",
      ]);
    });

    it("looks only where a program with a folder points, from the command's folder", () => {
      expect(programCandidates(".\\gradlew", { folder: "C:\\work", environment: {} })).toEqual([
        "C:\\work\\gradlew",
        "C:\\work\\gradlew.COM",
        "C:\\work\\gradlew.EXE",
        "C:\\work\\gradlew.BAT",
        "C:\\work\\gradlew.CMD",
      ]);
    });
  });

  it("names a variable alike in any case", () => {
    const { sameVariableName } = windows({ variables: {}, homeDirectory });

    expect(sameVariableName("Path", "PATH")).toBe(true);
    expect(sameVariableName("PATH", "PATHEXT")).toBe(false);
  });
});
