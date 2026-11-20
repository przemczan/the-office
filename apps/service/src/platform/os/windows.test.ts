import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { windows } from "./windows.js";

const homeDirectory = "C:\\Users\\office";

/** Windows paths as written, backslashes and all. */
const raw = String.raw;

/** How Git Bash runs `echo hi` under these variables. */
const bashOf = (variables: Record<string, string>) =>
  windows({ variables, homeDirectory }).agentShells[0]?.invocation("echo hi");

describe("windows", () => {
  describe("paths.resolve, isWithin and names", () => {
    const { paths } = windows({ variables: {}, homeDirectory });

    it("finds a path inside a folder whatever its case, and never a sibling that shares a prefix", () => {
      expect(paths.isWithin(raw`c:\users\OFFICE\.ssh\id`, raw`C:\Users\office\.ssh`)).toBe(true);
      expect(paths.isWithin(raw`C:\Users\office`, raw`C:\Users\office`)).toBe(true);
      expect(paths.isWithin(raw`C:\Users\office\.sshx`, raw`C:\Users\office\.ssh`)).toBe(false);
      expect(paths.isWithin(raw`C:\Users\office\..foo`, raw`C:\Users\office`)).toBe(true);
      expect(paths.isWithin(raw`D:\Users\office`, raw`C:\Users\office`)).toBe(false);
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

  it("names a local socket as a named pipe, and calls a hook's quoted words with & for PowerShell", () => {
    const system = windows({ variables: {}, homeDirectory });

    expect(system.localSocketPath("office-gemini-1")).toBe(raw`\\.\pipe\office-gemini-1`);
    expect(system.nodeScriptHookCommand(raw`C:\relay.js`, ["hook", raw`C:\it's.json`])).toBe(
      `& '${process.execPath}' 'C:\\relay.js' 'hook' 'C:\\it''s.json'`,
    );
  });
});
