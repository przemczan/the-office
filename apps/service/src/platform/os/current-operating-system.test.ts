import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "./current-operating-system.js";

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

  it("runs a command line in the default shell with its quotes as written", () => {
    // Node's own path is quoted and may hold spaces ("C:\Program Files\nodejs\node.exe").
    const result = run(`"${process.execPath}" -e "console.log(process.argv[1])" "two words"`);

    expect(result.error).toBeUndefined();
    expect(result.stdout.trim()).toBe("two words");
    expect(result.status).toBe(0);
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

    it.runIf(process.platform === "linux")(
      "knows a file that isn't executable could not run",
      async () => {
        await writeFile(join(folder, "not-executable.sh"), "echo ran\n", { mode: 0o644 });

        await expect(couldNotRun("./not-executable.sh")).resolves.toBe(true);
      },
    );
  });
});
