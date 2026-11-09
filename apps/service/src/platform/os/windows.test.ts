import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { programCandidates, programOf, windows } from "./windows.js";

const homeDirectory = "C:\\Users\\office";

/** Windows paths as written, backslashes and all. */
const raw = String.raw;

/** How Git Bash runs `echo hi` under these variables. */
const bashOf = (variables: Record<string, string>) =>
  windows({ variables, homeDirectory }).agentShells[0]?.invocation("echo hi");

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

  it("refuses updating The Office", () => {
    expect(windows({ variables: {}, homeDirectory }).officeUpdateRefusal).toBe(
      "Updating The Office runs on Linux only.",
    );
  });

  it("has no load average", () => {
    expect(windows({ variables: {}, homeDirectory }).hasLoadAverage).toBe(false);
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

  describe("paths.resolve, isWithin and names", () => {
    const { paths } = windows({ variables: {}, homeDirectory });

    it("reads a relative path from the base, and a Git Bash path as the drive path it names", () => {
      expect(paths.resolve(raw`C:\work`, "src/../plan.md")).toBe(raw`C:\work\plan.md`);
      expect(paths.resolve(raw`C:\work`, "/d/Projects/x")).toBe(raw`d:\Projects\x`);
      expect(paths.resolve(raw`C:\work`, "/c")).toBe("c:\\");
      expect(paths.resolve(raw`C:\work`, "/tmp/x")).toBe(raw`C:\tmp\x`);
    });

    it("finds a path inside a folder whatever its case, and never a sibling that shares a prefix", () => {
      expect(paths.isWithin(raw`c:\users\OFFICE\.ssh\id`, raw`C:\Users\office\.ssh`)).toBe(true);
      expect(paths.isWithin(raw`C:\Users\office`, raw`C:\Users\office`)).toBe(true);
      expect(paths.isWithin(raw`C:\Users\office\.sshx`, raw`C:\Users\office\.ssh`)).toBe(false);
      expect(paths.isWithin(raw`C:\Users\office\..foo`, raw`C:\Users\office`)).toBe(true);
      expect(paths.isWithin(raw`D:\Users\office`, raw`C:\Users\office`)).toBe(false);
    });

    it("names a path's parts in lower case, split at either slash", () => {
      expect(paths.names(raw`C:\Users/Office\.SSH`)).toEqual(["c:", "users", "office", ".ssh"]);
    });
  });

  it("keeps secrets in the home directory and the AppData folders", () => {
    const { secretPaths } = windows({
      variables: { APPDATA: raw`D:\Roaming`, LOCALAPPDATA: raw`D:\Local` },
      homeDirectory,
    });

    expect(secretPaths).toEqual(
      expect.arrayContaining([
        raw`C:\Users\office\.ssh`,
        raw`C:\Users\office\.claude\.credentials.json`,
        raw`D:\Roaming\GitHub CLI`,
        raw`C:\Users\office\.aws`,
        raw`D:\Local\Google\Chrome\User Data`,
        raw`D:\Roaming\Mozilla\Firefox\Profiles`,
      ]),
    );
  });

  it("has the engine keep its temporary files in claude in %TEMP%", () => {
    expect(
      windows({ variables: { TEMP: raw`C:\Users\office\AppData\Local\Temp` }, homeDirectory })
        .engineTemporaryFolder,
    ).toBe(raw`C:\Users\office\AppData\Local\Temp\claude`);
    expect(windows({ variables: {}, homeDirectory }).engineTemporaryFolder).toBe(
      raw`C:\Users\office\AppData\Local\Temp\claude`,
    );
  });

  it("finds the bundled Claude Code in the package for this architecture", () => {
    expect(windows({ variables: {}, homeDirectory }).claudeCodeBinaries).toEqual([
      `win32-${process.arch}/claude.exe`,
    ]);
  });

  it("has Agents run commands in Bash and PowerShell", () => {
    expect(windows({ variables: {}, homeDirectory }).agentShells.map(({ shell }) => shell)).toEqual(
      ["bash", "powershell"],
    );
  });

  describe("agentShells", () => {
    let folder: string;

    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "office-git-bash-"));
    });

    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    async function file(...segments: string[]): Promise<string> {
      const path = join(folder, ...segments);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
      return path;
    }

    it("runs PowerShell by its full path, the command line after -Command with its output in UTF-8", () => {
      const powerShell = windows({ variables: { SystemRoot: raw`D:\Windows` }, homeDirectory })
        .agentShells[1];
      expect(powerShell?.invocation("Get-ChildItem")).toEqual({
        file: raw`D:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
        arguments: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; Get-ChildItem",
        ],
        windowsVerbatimArguments: false,
      });
    });

    it("runs Git Bash where Git for Windows installs it when nothing else names one", () => {
      expect(bashOf({ ProgramFiles: raw`D:\Apps`, PATH: "" })).toEqual({
        file: raw`D:\Apps\Git\bin\bash.exe`,
        arguments: ["-c", "echo hi"],
        windowsVerbatimArguments: false,
      });
    });

    it.runIf(process.platform === "win32")(
      "runs the Git Bash CLAUDE_CODE_GIT_BASH_PATH names, as Claude Code does",
      async () => {
        const bash = await file("portable", "bash.exe");
        expect(bashOf({ CLAUDE_CODE_GIT_BASH_PATH: bash })?.file).toBe(bash);
      },
    );

    it.runIf(process.platform === "win32")(
      "finds Git Bash beside the git.exe on PATH, never a bash.exe on PATH",
      async () => {
        const git = await file("Git", "cmd", "git.exe");
        const bash = await file("Git", "bin", "bash.exe");
        const wsl = await file("System32", "bash.exe");
        expect(bashOf({ Path: `${dirname(wsl)};${dirname(git)}` })?.file).toBe(bash);
      },
    );
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

  describe("git's home", () => {
    const { gitHomeDirectory } = windows({ variables: {}, homeDirectory });

    it("is HOME in any case when the command has it", () => {
      expect(gitHomeDirectory({ Home: "D:\\home", USERPROFILE: "C:\\Users\\me" })).toBe("D:\\home");
    });

    it("is HOMEDRIVE and HOMEPATH while that folder exists, else USERPROFILE", () => {
      const existing = tmpdir();
      const drive = existing.slice(0, 2);
      const variables = {
        HOMEDRIVE: drive,
        HOMEPATH: existing.slice(2),
        USERPROFILE: "C:\\Users\\me",
      };

      expect(gitHomeDirectory(variables)).toBe(existing);
      expect(gitHomeDirectory({ ...variables, HOMEPATH: "\\no such folder" })).toBe(
        "C:\\Users\\me",
      );
      expect(gitHomeDirectory({})).toBe(homeDirectory);
    });
  });
});
