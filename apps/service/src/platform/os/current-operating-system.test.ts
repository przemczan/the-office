import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { currentOperatingSystem } from "./current-operating-system.js";

// Runs on whichever system the tests run on: Windows in npm run verify, Linux in verify:linux.
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

  it("reports the command line's exit code", () => {
    expect(run("exit 3").status).toBe(3);
  });
});
