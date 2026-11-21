import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProjectCommandRunner } from "../../application/project-command-runner.js";
import {
  UNCHANGED_ENVIRONMENT,
  type ProjectEnvironment,
} from "../../domain/project-environment.js";
import { ShellCommandRunner } from "./shell-command-runner.js";
import { aCommandsFolder } from "./shell-command-runner.fixtures.js";

// Real commands in the default shell of whichever system the tests run on: cmd.exe on Windows,
// sh on Linux and in a run environment.
const runner = new ProjectCommandRunner(new ShellCommandRunner());
let folder: string;

beforeAll(async () => {
  folder = await aCommandsFolder();
});

afterAll(async () => {
  // The processes the tests ended worked in it, and Windows may hold it a moment after they end.
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function run(commandLine: string, environment: ProjectEnvironment = UNCHANGED_ENVIRONMENT) {
  return runner.run({ commandLine, folder, environment, timeoutMs: 20_000 });
}

describe("ProjectCommandRunner with ShellCommandRunner", () => {
  it("records a command that passed, with its output and duration", async () => {
    const commandRun = await run(`node -e "console.log('built in ' + 2 + ' s')"`);

    expect(commandRun).toMatchObject({ outcome: "passed", exitCode: 0, output: "built in 2 s" });
    expect(commandRun.durationMs).toBeGreaterThan(0);
  });

  it("records a command that failed, with its exit code", async () => {
    await expect(run(`node -e "process.exit(3)"`)).resolves.toMatchObject({
      outcome: "failed",
      exitCode: 3,
    });
  });

  it("hides a Secret variable it prints, in its output and its file, cut across chunks too", async () => {
    await writeFile(
      join(folder, "print-token.cjs"),
      `process.stdout.write("token: " + process.env.NPM_TOKEN.slice(0, 5));
setTimeout(() => process.stdout.write(process.env.NPM_TOKEN.slice(5) + " done\\n"), 200);`,
    );
    const outputFile = join(folder, "token.log");

    const ran = await runner.run({
      commandLine: "node print-token.cjs",
      folder,
      environment: {
        set: [{ name: "NPM_TOKEN", value: "npm_s3cret", secret: true }],
        unset: [],
        prependPath: [],
      },
      timeoutMs: 20_000,
      outputFile,
    });

    expect(ran.outcome).toBe("passed");
    expect(ran.output).toBe("token: [secret NPM_TOKEN] done");
    expect(ran.wholeOutput).toBe("token: [secret NPM_TOKEN] done");
    expect(await readFile(outputFile, "utf8")).toBe("token: [secret NPM_TOKEN] done\n");
  });

  it("appends to its file when asked, keeping what the file held", async () => {
    const outputFile = join(folder, "appended.log");
    await writeFile(outputFile, "[The Office] Building.\n");

    await runner.run({
      commandLine: `node -e "console.log('built')"`,
      folder,
      environment: UNCHANGED_ENVIRONMENT,
      timeoutMs: 20_000,
      outputFile,
      appendOutput: true,
    });

    expect(await readFile(outputFile, "utf8")).toBe("[The Office] Building.\nbuilt\n");
  });
});
