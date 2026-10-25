import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProjectCommandRunner } from "../../application/project-command-runner.js";
import {
  UNCHANGED_ENVIRONMENT,
  type ProjectEnvironment,
} from "../../domain/project-environment.js";
import { ShellCommandRunner } from "./shell-command-runner.js";

// Real commands in the default shell of whichever system the tests run on: cmd.exe in
// npm run verify on Windows, sh in verify:linux.
const runner = new ProjectCommandRunner(new ShellCommandRunner());
let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-commands-"));
  await writeFile(join(folder, "print-environment.cjs"), PRINT_ENVIRONMENT);
  await writeFile(join(folder, "leave-a-process.cjs"), LEAVE_A_PROCESS);
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const PRINT_ENVIRONMENT = `
const { delimiter } = require("node:path");
for (const name of ["GREETING", "LEFT_OVER", "NODE_ENV", "DATABASE_URL"]) {
  console.log(name + "=" + (process.env[name] ?? ""));
}
const path = Object.entries(process.env).find(([name]) => name.toUpperCase() === "PATH")[1];
console.log("PATH starts with " + path.split(delimiter)[0]);
`;

/**
 * Starts a process that holds its output open and writes its id to the file named first. Then
 * either sleeps, or with "and-exit" leaves the process running on its own and exits.
 */
const LEAVE_A_PROCESS = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const exits = process.argv[3] === "and-exit";
// Detached, so Node on Windows doesn't end it with its parent.
const left = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
  stdio: "inherit",
  detached: exits,
});
writeFileSync(process.argv[2], String(left.pid));
console.log("started " + left.pid);
if (exits) left.unref();
`;

function run(commandLine: string, environment: ProjectEnvironment = UNCHANGED_ENVIRONMENT) {
  return runner.run({ commandLine, folder, environment, timeoutMs: 20_000 });
}

/** Whether the process is still running, after giving it a moment to end. */
async function isRunning(processId: number): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      process.kill(processId, 0);
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
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

  it("tells a command whose program isn't installed from one that failed", async () => {
    await expect(run("office-no-such-program --version")).resolves.toMatchObject({
      outcome: "could-not-run",
    });
  });

  it("runs with the Project's environment and without The Office's own variables", async () => {
    vi.stubEnv("LEFT_OVER", "inherited");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://office:secret@127.0.0.1:5432/the_office");
    const tools = join(folder, "tools");
    await mkdir(tools, { recursive: true });

    const commandRun = await run("node print-environment.cjs", {
      set: [{ name: "GREETING", value: "hello" }],
      unset: ["LEFT_OVER"],
      prependPath: [tools],
    });

    expect(commandRun.output.split(/\r?\n/)).toEqual([
      "GREETING=hello",
      "LEFT_OVER=",
      "NODE_ENV=",
      "DATABASE_URL=",
      `PATH starts with ${tools}`,
    ]);
  });

  it("ends a command that runs out of time, with every process it started", async () => {
    const processIdFile = join(folder, "timed-out.pid");

    const commandRun = await runner.run({
      commandLine: `node leave-a-process.cjs "${processIdFile}"`,
      folder,
      environment: UNCHANGED_ENVIRONMENT,
      timeoutMs: 1_500,
    });

    expect(commandRun.outcome).toBe("timed-out");
    expect(commandRun.exitCode).toBeUndefined();
    expect(commandRun.durationMs).toBeLessThan(10_000);
    const left = Number(await readFile(processIdFile, "utf8"));
    await expect(isRunning(left)).resolves.toBe(false);
  });

  it("ends a command that is stopped, with every process it started", async () => {
    const processIdFile = join(folder, "stopped.pid");
    const stop = new AbortController();

    const running = runner.run({
      commandLine: `node leave-a-process.cjs "${processIdFile}"`,
      folder,
      environment: UNCHANGED_ENVIRONMENT,
      timeoutMs: 20_000,
      signal: stop.signal,
    });
    await expect.poll(() => readFile(processIdFile, "utf8").catch(() => "")).not.toBe("");
    stop.abort();

    await expect(running).resolves.toMatchObject({ outcome: "stopped", exitCode: undefined });
    const left = Number(await readFile(processIdFile, "utf8"));
    await expect(isRunning(left)).resolves.toBe(false);
  });

  it("runs nothing once stopped", async () => {
    const stop = new AbortController();
    stop.abort();

    await expect(
      runner.run({
        commandLine: `node -e "require('fs').writeFileSync('ran.txt', '')"`,
        folder,
        environment: UNCHANGED_ENVIRONMENT,
        timeoutMs: 20_000,
        signal: stop.signal,
      }),
    ).resolves.toMatchObject({ outcome: "stopped" });
    await expect(readFile(join(folder, "ran.txt")).catch(() => undefined)).resolves.toBeUndefined();
  });

  it("finishes when the command exits, though a process it left holds its output open", async () => {
    const processIdFile = join(folder, "left.pid");

    const commandRun = await run(`node leave-a-process.cjs "${processIdFile}" and-exit`);

    const left = Number(await readFile(processIdFile, "utf8"));
    process.kill(left);
    expect(commandRun).toMatchObject({ outcome: "passed", output: `started ${left}` });
  });
});
