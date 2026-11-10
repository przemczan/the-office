import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_MASK,
  ScriptedContainerRuntime,
} from "../adapters/scripted/scripted-container-runtime.fixtures.js";
import { RunEnvironmentImageBuilt } from "../domain/run-environment-events.js";
import {
  composeProjectNameOf,
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  IDLE_STOP_MS,
  officeLabels,
  type TaskInWorktree,
} from "../domain/run-environment.js";
import type { RunEnvironmentCommand } from "./run-environments.js";
import {
  runEnvironmentsTestbed,
  taskIn,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "./run-environments.fixtures.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app" }`,
  ".devcontainer/compose.yaml":
    "services:\n  app:\n    image: node:22\n    command: sleep infinity\n  postgres:\n    image: postgres:17\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
  "README.md": "# Shop\n",
};

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;

async function taskWithDefinition(taskId: string): Promise<TaskInWorktree> {
  const task = taskIn(testbed, taskId);
  await writeFiles(task.worktree, DEFINITION);
  return task;
}

function command(
  outputFile: string,
  extra: Partial<RunEnvironmentCommand> = {},
): RunEnvironmentCommand {
  return {
    commandLine: "npm test",
    environment: { set: [{ name: "CI", value: "1" }], unset: [], prependPath: [] },
    mask: NO_MASK,
    timeoutMs: 60_000,
    outputFile,
    ...extra,
  };
}

function outputOf(name: string): string {
  return join(testbed.folder, "output", name);
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  testbed = await runEnvironmentsTestbed(runtime, {
    ...DEFAULT_RUN_ENVIRONMENT_OPTIONS,
    runEnvironmentsAtOnce: 1,
  });
});

afterEach(async () => {
  await rm(testbed.folder, { recursive: true, force: true });
});

describe("RunEnvironments.prepare", () => {
  it("builds the image once per key: another Task, or a file outside the key, uses it again", async () => {
    const built: RunEnvironmentImageBuilt[] = [];
    testbed.events.subscribe(RunEnvironmentImageBuilt, (event) => void built.push(event));
    const first = await taskWithDefinition("task-1");
    const second = await taskWithDefinition("task-2");

    await testbed.environments.prepare(first, outputOf("first"));
    await testbed.environments.remove(first.taskId);
    await writeFiles(second.worktree, { "README.md": "# Shop, changed\n" });
    await testbed.environments.prepare(second, outputOf("second"));

    expect(runtime.builds).toHaveLength(1);
    expect(built).toHaveLength(1);
    expect(built[0]?.image).toMatch(/^the-office\/shop:[0-9a-f]{24}$/);
    expect(runtime.builds[0]).toMatchObject({
      image: built[0]?.image,
      dockerfile: "Dockerfile",
      labels: officeLabels(testbed.folders.instance),
    });
  });
});

describe("RunEnvironments.run", () => {
  it("runs the check in the worktree with the Project's environment, its output streamed to the file", async () => {
    const task = await taskWithDefinition("task-1");
    let script = "";
    runtime.onExec = async (execution) => {
      script = execution.script;
      return { output: "3 tests failed\n", exitCode: 1 };
    };

    const end = await testbed.environments.run(task, command(outputOf("check")));

    expect(end).toMatchObject({ exitCode: 1 });
    expect(await readFile(outputOf("check"), "utf8")).toContain("3 tests failed\n");
    expect(script).toBe(
      [
        `cd '${task.worktree}' || exit 125`,
        'export CI="$OFFICE_VARIABLE_0"',
        "unset OFFICE_VARIABLE_0",
        "npm test",
      ].join("\n"),
    );
  });

  it("waits for a slot, saying so, while Run environments at once are running, until one stops idle", async () => {
    const first = await taskWithDefinition("task-1");
    const second = await taskWithDefinition("task-2");
    // The first check ends when the test says.
    let endFirstCheck: (() => void) | undefined;
    const firstCheck = new Promise<void>((resolve) => {
      endFirstCheck = resolve;
    });
    runtime.onExec = () => firstCheck.then(() => ({ exitCode: 0 }));
    const firstRun = testbed.environments.run(first, command(outputOf("first")));
    await vi.waitFor(() =>
      expect(runtime.steps.some((step) => step.startsWith("exec"))).toBe(true),
    );

    const told: string[] = [];
    const onWaiting = vi.fn<() => void>(() => void told.push("waiting"));
    const onWaitOver = vi.fn<() => void>(() => void told.push("wait over"));
    const secondRun = testbed.environments.run(
      second,
      command(outputOf("second"), { onWaiting, onWaitOver }),
    );
    await vi.waitFor(() => expect(onWaiting).toHaveBeenCalledOnce());
    endFirstCheck?.();
    await firstRun;
    let timeoutMs = 0;
    runtime.onExec = (execution) => {
      timeoutMs = execution.timeoutMs;
      return Promise.resolve({ exitCode: 0 });
    };
    // The first Task's run environment is still running, so it still holds the only slot.
    expect(runtime.steps.filter((step) => step.startsWith("up "))).toHaveLength(1);
    expect(onWaitOver).not.toHaveBeenCalled();

    await testbed.schedule.advanceBy(IDLE_STOP_MS);

    const end = await secondRun;
    expect(end).toMatchObject({ exitCode: 0 });
    expect(told).toEqual(["waiting", "wait over"]);
    // The time limit and the duration count from the check's start, not the wait's.
    expect(timeoutMs).toBe(command(outputOf("second")).timeoutMs);
    expect(end.durationMs).toBeLessThan(IDLE_STOP_MS);
    const firstName = composeProjectNameOf(testbed.folders.instance, "task-1");
    expect(runtime.projects.get(firstName)?.state).toBe("stopped");
  });
});
