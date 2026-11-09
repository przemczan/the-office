import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStateChanged } from "../../work/index.js";
import {
  NO_MASK,
  ScriptedContainerRuntime,
} from "../adapters/scripted/scripted-container-runtime.fixtures.js";
import {
  RunEnvironmentCreated,
  RunEnvironmentImageBuilt,
  RunEnvironmentRemoved,
} from "../domain/run-environment-events.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  composeProjectNameOf,
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  IDLE_STOP_MS,
  officeLabels,
  taskLabels,
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

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
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

  it("builds a new image when an Install input's contents change", async () => {
    const first = await taskWithDefinition("task-1");
    await testbed.environments.prepare(first, outputOf("first"));
    await testbed.environments.remove(first.taskId);
    const second = await taskWithDefinition("task-2");
    await writeFiles(second.worktree, { "package-lock.json": '{ "lockfileVersion": 4 }' });

    await testbed.environments.prepare(second, outputOf("second"));

    expect(runtime.builds.map(({ image }) => image)).toHaveLength(2);
    expect(new Set(runtime.builds.map(({ image }) => image)).size).toBe(2);
  });

  it("builds the definition's own Dockerfile first, and the image over it", async () => {
    const task = taskIn(testbed, "task-1");
    await writeFiles(task.worktree, {
      ...DEFINITION,
      ".devcontainer/compose.yaml":
        "services:\n  app:\n    build:\n      context: ..\n      dockerfile: .devcontainer/Dockerfile\n",
    });

    await testbed.environments.prepare(task, outputOf("prepare"));

    expect(runtime.builds.map(({ image }) => image.replace(/:.*/, ""))).toEqual([
      "the-office/shop-base",
      "the-office/shop",
    ]);
    expect(runtime.builds[0]).toMatchObject({
      context: task.worktree,
      dockerfile: ".devcontainer/Dockerfile",
    });
  });

  it("gives the Task its own compose project, made once: a second prepare uses it again", async () => {
    const created: RunEnvironmentCreated[] = [];
    testbed.events.subscribe(RunEnvironmentCreated, (event) => void created.push(event));
    const task = await taskWithDefinition("task-1");

    await testbed.environments.prepare(task, outputOf("prepare"));
    await testbed.environments.prepare(task, outputOf("prepare"));

    const name = composeProjectNameOf(testbed.folders.instance, "task-1");
    expect(runtime.steps.filter((step) => step.startsWith("up "))).toEqual([`up ${name}`]);
    expect(created.map(({ taskId }) => taskId)).toEqual(["task-1"]);
    const { project } = runtime.projects.get(name) ?? {};
    expect(project).toMatchObject({
      files: [
        join(task.worktree, ".devcontainer/compose.yaml"),
        join(testbed.folders.taskFolder("task-1"), "office-override.yaml"),
      ],
      projectDirectory: join(task.worktree, ".devcontainer"),
      services: ["app", "postgres"],
    });
    const override = await readFile(
      join(testbed.folders.taskFolder("task-1"), "office-override.yaml"),
      "utf8",
    );
    expect(override).toContain(`target: ${task.worktree}`);
    expect(override).toContain("pids_limit: 1024");
  });

  it("refuses an invalid definition with every problem in the UI's words", async () => {
    const task = taskIn(testbed, "task-1");
    await mkdir(task.worktree, { recursive: true });

    const preparing = testbed.environments.prepare(task, outputOf("prepare"));

    await expect(preparing).rejects.toThrow(RunEnvironmentRefused);
    await expect(preparing).rejects.toMatchObject({
      reasons: ["The repository has no .devcontainer/devcontainer.json."],
    });
    expect(runtime.steps).toEqual([]);
  });

  it("refuses with why and where the output is when the image doesn't build", async () => {
    const task = await taskWithDefinition("task-1");
    runtime.failing.add("build");

    await expect(testbed.environments.prepare(task, outputOf("prepare"))).rejects.toMatchObject({
      reasons: [
        "The run environment's image couldn't be built.",
        expect.stringMatching(/^The image the-office\/shop:\w+ couldn't be built\.$/),
      ],
      outputFile: outputOf("prepare"),
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

  it("counts as busy work while it runs", async () => {
    const task = await taskWithDefinition("task-1");
    let busy: readonly unknown[] = [];
    runtime.onExec = async () => {
      busy = testbed.busyWork.list();
      return { exitCode: 0 };
    };

    await testbed.environments.run(task, command(outputOf("check")));

    expect(busy).toEqual([
      { kind: "run-environment", label: 'The run environment of the Task "Task task-1"' },
    ]);
    expect(testbed.busyWork.list()).toEqual([]);
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

  it("starts a run environment stopped idle again at the next check", async () => {
    const task = await taskWithDefinition("task-1");
    await testbed.environments.run(task, command(outputOf("first")));
    await testbed.schedule.advanceBy(IDLE_STOP_MS);

    await testbed.environments.run(task, command(outputOf("second")));

    const name = composeProjectNameOf(testbed.folders.instance, "task-1");
    expect(runtime.steps.filter((step) => step.endsWith(name))).toEqual([
      `up ${name}`,
      `exec ${name}`,
      `stop ${name}`,
      `up ${name}`,
      `exec ${name}`,
    ]);
  });

  it("frees the slot when the run environment doesn't start", async () => {
    const first = await taskWithDefinition("task-1");
    const second = await taskWithDefinition("task-2");
    runtime.failing.add("up");

    await expect(testbed.environments.run(first, command(outputOf("first")))).rejects.toMatchObject(
      { reasons: [expect.stringMatching(/couldn't start/), expect.any(String)] },
    );
    const onWaiting = vi.fn<() => void>();

    expect(
      await testbed.environments.run(second, command(outputOf("second"), { onWaiting })),
    ).toMatchObject({ exitCode: 0 });
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("stops the run environment and frees its slot when the check can't run in it", async () => {
    const first = await taskWithDefinition("task-1");
    const second = await taskWithDefinition("task-2");
    runtime.failing.add("exec");

    await expect(testbed.environments.run(first, command(outputOf("first")))).rejects.toThrow(
      RunEnvironmentRefused,
    );
    const onWaiting = vi.fn<() => void>();
    await testbed.environments.run(second, command(outputOf("second"), { onWaiting }));

    expect(onWaiting).not.toHaveBeenCalled();
    const firstName = composeProjectNameOf(testbed.folders.instance, "task-1");
    expect(runtime.projects.get(firstName)?.state).toBe("stopped");
  });

  it("takes the slot even when telling of the wait fails, and runs the check", async () => {
    const first = await taskWithDefinition("task-1");
    const second = await taskWithDefinition("task-2");
    await testbed.environments.prepare(first, outputOf("first"));
    const secondRun = testbed.environments.run(
      second,
      command(outputOf("second"), {
        onWaiting: () => Promise.reject(new Error("The database is gone.")),
        onWaitOver: () => Promise.reject(new Error("The database is gone.")),
      }),
    );

    await testbed.schedule.advanceBy(IDLE_STOP_MS);

    await expect(secondRun).resolves.toMatchObject({ exitCode: 0 });
  });

  it("gives up waiting when stopped", async () => {
    const first = await taskWithDefinition("task-1");
    const second = await taskWithDefinition("task-2");
    await testbed.environments.prepare(first, outputOf("first"));
    const stop = new AbortController();

    const onWaitOver = vi.fn<() => void>();
    const waiting = testbed.environments.run(
      second,
      command(outputOf("second"), {
        signal: stop.signal,
        onWaiting: () => stop.abort(),
        onWaitOver,
      }),
    );

    await expect(waiting).rejects.toThrow("This operation was aborted");
    expect(onWaitOver).toHaveBeenCalledOnce();
    expect(runtime.steps.filter((step) => step.startsWith("up "))).toHaveLength(1);
  });
});

describe("RunEnvironments, as Tasks finish", () => {
  it.each(["done", "dropped"] as const)(
    "removes the Task's containers, network, volumes and files when it is %s",
    async (state) => {
      const removed: RunEnvironmentRemoved[] = [];
      testbed.events.subscribe(RunEnvironmentRemoved, (event) => void removed.push(event));
      const task = await taskWithDefinition("task-1");
      await testbed.environments.prepare(task, outputOf("prepare"));
      const labels = taskLabels(testbed.folders.instance, "task-1");
      expect(await runtime.listByLabel(labels)).not.toEqual([]);

      await testbed.events.publish(new TaskStateChanged("task-1", "in-progress", state));

      await vi.waitFor(() => expect(removed.map(({ taskId }) => taskId)).toEqual(["task-1"]));
      expect(runtime.steps).toContain(`remove ${JSON.stringify(labels)}`);
      expect(await runtime.listByLabel(labels)).toEqual([]);
      expect(await exists(testbed.folders.taskFolder("task-1"))).toBe(false);
    },
  );

  it("frees the removed Task's slot", async () => {
    const first = await taskWithDefinition("task-1");
    const second = await taskWithDefinition("task-2");
    await testbed.environments.prepare(first, outputOf("first"));

    await testbed.environments.remove("task-1");
    const onWaiting = vi.fn<() => void>();
    await testbed.environments.prepare(second, outputOf("second"), { onWaiting });

    expect(onWaiting).not.toHaveBeenCalled();
  });

  it("asks the runtime nothing for a Task that never had a run environment", async () => {
    await testbed.events.publish(new TaskStateChanged("task-9", "in-progress", "done"));
    await testbed.environments.remove("task-9");

    expect(runtime.steps).toEqual([]);
  });
});

describe("RunEnvironments.sweep", () => {
  it("removes leftovers no open Task owns, stops the open Tasks', and keeps another Office's", async () => {
    const instance = testbed.folders.instance;
    const live = await taskWithDefinition("live");
    await testbed.environments.prepare(live, outputOf("live"));
    runtime.leave({ kind: "container", id: "c-gone", labels: taskLabels(instance, "gone") });
    runtime.leave({ kind: "volume", id: "v-done", labels: taskLabels(instance, "finished") });
    runtime.leave({ kind: "network", id: "n-other", labels: taskLabels("another", "gone") });
    await mkdir(testbed.folders.taskFolder("only-files"), { recursive: true });
    testbed.knownTasks.tasks = [
      { id: "live", title: "Live", state: "in-progress" },
      { id: "finished", title: "Finished", state: "done" },
    ];

    await testbed.environments.sweep();

    expect(runtime.resources.map(({ id }) => id).toSorted()).toEqual(
      [
        `${composeProjectNameOf(instance, "live")}_app`,
        `${composeProjectNameOf(instance, "live")}_default`,
        `${composeProjectNameOf(instance, "live")}_postgres`,
        "n-other",
      ].toSorted(),
    );
    expect(runtime.projects.get(composeProjectNameOf(instance, "live"))?.state).toBe("stopped");
    expect(await exists(testbed.folders.taskFolder("live"))).toBe(true);
    expect(await exists(testbed.folders.taskFolder("only-files"))).toBe(false);
  });

  it("removes the Office's images but the newest of each Project's", async () => {
    runtime.images.set("the-office/shop:old", new Date("2026-11-01T00:00:00Z"));
    runtime.images.set("the-office/shop:new", new Date("2026-11-02T00:00:00Z"));
    runtime.images.set("the-office/blog:only", new Date("2026-10-01T00:00:00Z"));

    await testbed.environments.sweep();

    expect([...runtime.images.keys()].toSorted()).toEqual([
      "the-office/blog:only",
      "the-office/shop:new",
    ]);
  });
});
