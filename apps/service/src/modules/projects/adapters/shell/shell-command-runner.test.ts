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

// Real commands in the default shell of whichever system the tests run on: cmd.exe on Windows,
// sh on Linux and in a run environment.
const runner = new ProjectCommandRunner(new ShellCommandRunner());
let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "office-commands-"));
  await writeFile(join(folder, "print-environment.cjs"), PRINT_ENVIRONMENT);
  await writeFile(join(folder, "leave-a-process.cjs"), LEAVE_A_PROCESS);
});

afterAll(async () => {
  // The processes the tests ended worked in it, and Windows may hold it a moment after they end.
  await rm(folder, { recursive: true, force: true, maxRetries: 5 });
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

  it("keeps the last 64 KB of a long output, saying how much was cut", async () => {
    const commandRun = await run(`node -e "process.stdout.write('x'.repeat(70 * 1024))"`);

    const [cutLine, kept] = commandRun.wholeOutput.split("\n");
    expect(cutLine).toBe("… 6 KB cut from the start");
    expect(kept).toHaveLength(64 * 1024);
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

  it("runs a line an Agent wrote in the Bash Agents have, not the Project's shell", async () => {
    const commandRun = await runner.run({
      commandLine: 'echo "bash ${BASH_VERSINFO[0]}"',
      folder,
      environment: UNCHANGED_ENVIRONMENT,
      timeoutMs: 20_000,
      inAgentBash: true,
    });

    expect(commandRun).toMatchObject({ outcome: "passed" });
    expect(commandRun.output.trim()).toMatch(/^bash \d+$/);
  });

  it("runs with the Project's environment and without The Office's own variables", async () => {
    vi.stubEnv("LEFT_OVER", "inherited");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://office:secret@127.0.0.1:5432/the_office");
    const tools = join(folder, "tools");
    await mkdir(tools, { recursive: true });

    const commandRun = await run("node print-environment.cjs", {
      set: [{ name: "GREETING", value: "hello", secret: false }],
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

  it("hides a Secret variable whose start falls in the output dropped past the limit", async () => {
    // The value is cut across two chunks, and 16 MiB follow its end, so the first chunk is dropped
    // and the kept end starts in the middle of the value. The failure next to it keeps that line
    // in the filtered output.
    await writeFile(
      join(folder, "print-token-then-more.cjs"),
      `process.stdout.write("token: " + process.env.NPM_TOKEN.slice(0, 6));
setTimeout(() => {
  const more = ("x".repeat(15) + "\\n").repeat(1024 * 1024);
  process.stdout.write(process.env.NPM_TOKEN.slice(6) + " was refused: error\\n" + more);
}, 200);`,
    );

    const ran = await runner.run({
      commandLine: "node print-token-then-more.cjs",
      folder,
      environment: {
        set: [{ name: "NPM_TOKEN", value: "npm_s3cretTail", secret: true }],
        unset: [],
        prependPath: [],
      },
      timeoutMs: 20_000,
    });

    expect(ran.outcome).toBe("passed");
    expect(ran.wholeOutput.includes("cretTail")).toBe(false);
    expect(ran.output.includes("cretTail")).toBe(false);
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
