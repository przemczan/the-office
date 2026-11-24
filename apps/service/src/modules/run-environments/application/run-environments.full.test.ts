import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStateChanged } from "../../work/index.js";
import {
  NO_MASK,
  ScriptedContainerRuntime,
} from "../adapters/scripted/scripted-container-runtime.js";
import { RunEnvironmentCreated, RunEnvironmentRemoved } from "../domain/run-environment-events.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  composeProjectNameOf,
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  IDLE_STOP_MS,
  taskLabels,
  type TaskInWorktree,
} from "../domain/run-environment.js";
import { ContainerRuntimeFailed, type Execution } from "../ports/container-runtime.js";
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

  it("starts the run environment again on its worktree when the folder was replaced", async () => {
    const task = await taskWithDefinition("task-1");
    await testbed.environments.run(task, command(outputOf("first")));
    await testbed.environments.run(task, command(outputOf("same folder")));
    // As Publish removes the worktree and the next Stage adds it again at the same path. The old
    // folder is moved, not deleted: a running container's mount keeps it, so its inode isn't
    // reused for the new one, as the filesystem would for a folder nothing holds.
    await rename(task.worktree, `${task.worktree}-removed`);
    await writeFiles(task.worktree, DEFINITION);
    const onWaiting = vi.fn<() => void>();

    const end = await testbed.environments.run(task, command(outputOf("replaced"), { onWaiting }));

    expect(end).toMatchObject({ exitCode: 0 });
    const name = composeProjectNameOf(testbed.folders.instance, "task-1");
    expect(runtime.steps.filter((step) => step.endsWith(name))).toEqual([
      `up ${name}`,
      `exec ${name}`,
      `exec ${name}`,
      `stop ${name}`,
      `up ${name}`,
      `exec ${name}`,
    ]);
    // Its own slot, freed and taken again, with only one run environment at once.
    expect(onWaiting).not.toHaveBeenCalled();
    expect(await readFile(outputOf("replaced"), "utf8")).toContain(
      "The Task's worktree was replaced; starting the run environment again.",
    );
  });

  it("starts the run environment again on another folder of the Task, and again on its own", async () => {
    const task = await taskWithDefinition("task-1");
    await testbed.environments.run(task, command(outputOf("first")));
    // As the environment check runs in a throwaway worktree of the Task.
    const throwaway = { ...task, worktree: join(testbed.folder, "throwaway", "task-1") };
    await writeFiles(throwaway.worktree, DEFINITION);

    await testbed.environments.run(throwaway, command(outputOf("throwaway")));
    await testbed.environments.run(task, command(outputOf("own again")));

    const name = composeProjectNameOf(testbed.folders.instance, "task-1");
    expect(runtime.steps.filter((step) => step.endsWith(name))).toEqual([
      `up ${name}`,
      `exec ${name}`,
      `stop ${name}`,
      `up ${name}`,
      `exec ${name}`,
      `stop ${name}`,
      `up ${name}`,
      `exec ${name}`,
    ]);
    expect(await readFile(outputOf("throwaway"), "utf8")).toContain(
      `The run environment runs on another folder; starting it again on ${throwaway.worktree}.`,
    );
    const override = await readFile(
      join(testbed.folders.taskFolder("task-1"), "office-override.yaml"),
      "utf8",
    );
    expect(override).toContain(task.worktree);
    expect(override).not.toContain(throwaway.worktree);
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

/** The hand-backs among the executions: the checks here name no user, the hand-back root. */
function handBacks(executions: readonly Execution[]): readonly Execution[] {
  return executions.filter(({ user }) => user === "0:0");
}

describe("RunEnvironments.run on a non-root Office", () => {
  const OWNER = { userId: 1000, groupId: 1000 };

  beforeEach(async () => {
    await rm(testbed.folder, { recursive: true, force: true });
    testbed = await runEnvironmentsTestbed(
      runtime,
      { ...DEFAULT_RUN_ENVIRONMENT_OPTIONS, runEnvironmentsAtOnce: 1 },
      OWNER,
    );
  });

  it.each(["timeout", "stop"] as const)(
    "gives the files back after a check that ended by %s, with no signal",
    async (endedBy) => {
      const task = await taskWithDefinition("task-1");
      const stop = new AbortController();
      const executions: Execution[] = [];
      runtime.onExec = async (execution) => {
        executions.push(execution);
        return executions.length === 1 ? { exitCode: undefined, endedBy } : { exitCode: 0 };
      };

      const end = await testbed.environments.run(
        task,
        command(outputOf("check"), { signal: stop.signal }),
      );

      expect(end).toMatchObject({ exitCode: undefined, endedBy });
      expect(executions).toHaveLength(2);
      expect(handBacks(executions)).toHaveLength(1);
      expect(executions[1]?.signal).toBeUndefined();
    },
  );

  it.each([
    {
      how: "exits non-zero",
      handBack: () => Promise.resolve({ exitCode: 1 }),
      why: "It ended with the exit code 1.",
    },
    {
      how: "times out",
      handBack: () => Promise.resolve({ exitCode: undefined, endedBy: "timeout" as const }),
      why: "It didn't end within 10 minutes.",
    },
    {
      how: "can't run",
      handBack: () => Promise.reject(new ContainerRuntimeFailed("The service app isn't running.")),
      why: "The service app isn't running.",
    },
  ])(
    "refuses the check, stops the run environment and frees its slot when the hand-back $how",
    async ({ handBack, why }) => {
      const first = await taskWithDefinition("task-1");
      const second = await taskWithDefinition("task-2");
      const executions: Execution[] = [];
      runtime.onExec = async (execution) => {
        executions.push(execution);
        return executions.length === 2 ? handBack() : { exitCode: 0 };
      };

      await expect(
        testbed.environments.run(first, command(outputOf("first"))),
      ).rejects.toMatchObject({
        reasons: ["The files the check wrote couldn't be given back to The Office's user.", why],
        outputFile: outputOf("first"),
      });
      const firstName = composeProjectNameOf(testbed.folders.instance, "task-1");
      expect(runtime.projects.get(firstName)?.state).toBe("stopped");

      const onWaiting = vi.fn<() => void>();
      await testbed.environments.run(second, command(outputOf("second"), { onWaiting }));
      expect(onWaiting).not.toHaveBeenCalled();

      // The next check of the Task starts it again and hands back what was left.
      await testbed.environments.remove(second.taskId);
      await expect(
        testbed.environments.run(first, command(outputOf("again"))),
      ).resolves.toMatchObject({ exitCode: 0 });
      expect(runtime.projects.get(firstName)?.state).toBe("running");
      expect(handBacks(executions)).toHaveLength(3);
    },
  );

  it("attempts no hand-back when the check itself couldn't run", async () => {
    const task = await taskWithDefinition("task-1");
    const executions: Execution[] = [];
    runtime.onExec = async (execution) => {
      executions.push(execution);
      return { exitCode: 0 };
    };
    runtime.failing.add("exec");

    await expect(testbed.environments.run(task, command(outputOf("check")))).rejects.toMatchObject({
      reasons: ["The check couldn't run in the run environment.", expect.any(String)],
    });
    expect(executions).toHaveLength(0);
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
