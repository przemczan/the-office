import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { currentOperatingSystem } from "./current-operating-system.js";
import { startProgram } from "./program.js";
import { isRunning } from "./process-trees.fixtures.js";

const { processTrees } = currentOperatingSystem();

const inherited = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

async function outputOf(child: ChildProcessWithoutNullStreams): Promise<string> {
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => (output += chunk));
  const [code] = (await once(child, "exit")) as [number | null];
  expect(code).toBe(0);
  return output.trim();
}

describe("startProgram", () => {
  // npm is npm.cmd on Windows, which only cmd.exe runs.
  it("runs a command as a shell finds it", { timeout: 30_000 }, async () => {
    const child = startProgram(
      { command: "npm", arguments: ["--version"], workingFolder: tmpdir(), environment: inherited },
      processTrees,
    );

    expect(await outputOf(child)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("passes each argument as given and only the environment given", async () => {
    const child = startProgram(
      {
        command: process.execPath,
        arguments: [
          "-e",
          "console.log(JSON.stringify([process.argv.slice(1), process.env.GIVEN, process.env.NOT_GIVEN]))",
          "a b",
          'say "hi" & exit',
        ],
        workingFolder: tmpdir(),
        environment: { GIVEN: "yes" },
      },
      processTrees,
    );

    expect(JSON.parse(await outputOf(child))).toEqual([["a b", 'say "hi" & exit'], "yes", null]);
  });

  it("starts it so that its tree can be ended", { timeout: 30_000 }, async () => {
    const child = startProgram(
      {
        command: process.execPath,
        arguments: ["-e", "setInterval(() => {}, 1000)"],
        workingFolder: tmpdir(),
        environment: inherited,
      },
      processTrees,
    );
    await once(child, "spawn");
    const processId = child.pid ?? 0;

    await processTrees.end(processId);

    expect(isRunning(processId)).toBe(false);
  });
});
