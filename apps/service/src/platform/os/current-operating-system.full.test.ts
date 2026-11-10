import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "./current-operating-system.js";
import { isRunning } from "./process-trees.fixtures.js";

// Runs on whichever system the tests run on: Windows on the workstation, Linux in a run environment.
describe("currentOperatingSystem", () => {
  const { defaultShell } = currentOperatingSystem();

  const run = (commandLine: string) => {
    const {
      file,
      arguments: shellArguments,
      windowsVerbatimArguments,
    } = defaultShell.invocation(commandLine);
    return spawnSync(file, shellArguments, { windowsVerbatimArguments, encoding: "utf8" });
  };

  it("reports the command line's exit code", () => {
    expect(run("exit 3").status).toBe(3);
  });

  it("ends what a process left running after it ended", async () => {
    const { processTrees } = currentOperatingSystem();
    const folder = await mkdtemp(join(tmpdir(), "office-leftovers-"));
    try {
      const pidFile = join(folder, "left.pid");
      // Starts a process that outlives it, writes its id, and exits. Node on Windows ends the
      // processes it started with it unless they are detached; on Linux that would leave the group.
      const leftDetached = process.platform === "win32";
      const parent = spawn(
        process.execPath,
        [
          "-e",
          `const left = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", detached: ${leftDetached} });
           require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(left.pid));
           left.unref();`,
        ],
        { detached: processTrees.detached, stdio: "ignore", windowsHide: true },
      );
      await new Promise((resolve) => parent.once("exit", resolve));
      const left = Number(await readFile(pidFile, "utf8"));
      expect(isRunning(left)).toBe(true);

      await processTrees.endLeftovers(parent.pid ?? 0);

      expect(isRunning(left)).toBe(false);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  describe("defaultShell.couldNotRun", () => {
    let folder: string;

    beforeAll(async () => {
      folder = await mkdtemp(join(tmpdir(), "office-shell-"));
    });

    afterAll(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    /** Runs the command line in the folder and asks the shell whether it could run it. */
    const couldNotRun = (commandLine: string): Promise<boolean> => {
      const environment = { ...process.env } as Record<string, string>;
      const {
        file,
        arguments: shellArguments,
        windowsVerbatimArguments,
      } = defaultShell.invocation(commandLine);
      const { status } = spawnSync(file, shellArguments, {
        cwd: folder,
        env: environment,
        windowsVerbatimArguments,
        stdio: "ignore",
      });
      expect(status).not.toBe(0);
      return defaultShell.couldNotRun({
        commandLine,
        exitCode: status ?? -1,
        folder,
        environment,
      });
    };

    it("knows a program that isn't installed could not run", async () => {
      await expect(couldNotRun("office-no-such-program --version")).resolves.toBe(true);
    });

    it("knows a program that failed ran", async () => {
      await expect(couldNotRun(`"${process.execPath}" -e "process.exit(3)"`)).resolves.toBe(false);
    });

    it("knows a built-in command that failed ran", async () => {
      const builtIn =
        process.platform === "win32" ? "dir office-no-such-folder" : "cd office-no-such-folder";

      await expect(couldNotRun(builtIn)).resolves.toBe(false);
    });

    it("knows a program named by a path that leads nowhere could not run", async () => {
      const nowhere =
        process.platform === "win32"
          ? '"C:\\office-nowhere\\tool.exe" --version'
          : "/office-nowhere/tool --version";

      await expect(couldNotRun(nowhere)).resolves.toBe(true);
    });
  });
});
