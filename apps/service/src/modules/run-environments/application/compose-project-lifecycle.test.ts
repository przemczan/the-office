import { Logger } from "@nestjs/common";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScriptedContainerRuntime } from "../adapters/scripted/scripted-container-runtime.js";
import { LABEL, officeLabels, taskLabels } from "../domain/run-environment.js";
import { ContainerRuntimeFailed } from "../ports/container-runtime.js";
import { ComposeProjectLifecycle, type OfficeComposeProject } from "./compose-project-lifecycle.js";

const INSTANCE = "a1b2c3d4e5f6";

let runtime: ScriptedContainerRuntime;
let logger: Logger;
let warn: ReturnType<typeof vi.spyOn>;
let lifecycle: ComposeProjectLifecycle;
let folder: string;

function projectOf(taskId: string): OfficeComposeProject {
  return {
    name: `office-${INSTANCE}-${taskId}`,
    labels: taskLabels(INSTANCE, taskId),
    folder: join(folder, taskId),
    removal: { builtImages: true },
    what: `The run environment of the Task ${taskId}`,
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  logger = new Logger("ComposeProjectLifecycleTest");
  warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
  lifecycle = new ComposeProjectLifecycle(runtime, INSTANCE, logger);
  folder = await mkdtemp(join(tmpdir(), "office-compose-lifecycle-"));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("ComposeProjectLifecycle.remove", () => {
  it("takes the project down, then removes what carries its labels, then its files", async () => {
    const project = projectOf("task-1");
    runtime.leave({ kind: "volume", id: "v-1", labels: project.labels });
    await mkdir(project.folder, { recursive: true });

    await lifecycle.remove(project);

    expect(runtime.steps).toEqual([
      `down ${project.name} with built images`,
      `remove ${JSON.stringify(project.labels)}`,
    ]);
    expect(runtime.resources).toEqual([]);
    expect(await exists(project.folder)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("goes on by the labels and the files when down fails, only logging it", async () => {
    const project = projectOf("task-1");
    runtime.leave({ kind: "container", id: "c-1", labels: project.labels });
    await mkdir(project.folder, { recursive: true });
    runtime.failing.add("down");

    await lifecycle.remove(project);

    expect(runtime.resources).toEqual([]);
    expect(await exists(project.folder)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "The run environment of the Task task-1 didn't come down.",
      expect.any(ContainerRuntimeFailed),
    );
  });

  it("still removes the files when the removal by label fails, then throws its failure", async () => {
    const project = projectOf("task-1");
    await mkdir(project.folder, { recursive: true });
    runtime.failing.add("remove");

    await expect(lifecycle.remove(project)).rejects.toBeInstanceOf(ContainerRuntimeFailed);

    expect(await exists(project.folder)).toBe(false);
  });
});

describe("ComposeProjectLifecycle's sweep", () => {
  it("finds the ids a label names on this Office's resources alone, each once", async () => {
    runtime.leave({ kind: "container", id: "c-1", labels: taskLabels(INSTANCE, "task-1") });
    runtime.leave({ kind: "volume", id: "v-1", labels: taskLabels(INSTANCE, "task-1") });
    runtime.leave({ kind: "volume", id: "v-2", labels: taskLabels("another", "task-2") });
    runtime.leave({
      kind: "volume",
      id: "v-3",
      labels: { ...officeLabels(INSTANCE), [LABEL.pairing]: "device-1" },
    });

    expect([...(await lifecycle.labelled(LABEL.task))]).toEqual(["task-1"]);
  });

  it("finds the folders of projects' files, none when the folder is missing", async () => {
    await mkdir(join(folder, "kind", "task-1"), { recursive: true });

    expect(await lifecycle.withFiles(join(folder, "kind"))).toEqual(["task-1"]);
    expect(await lifecycle.withFiles(join(folder, "missing"))).toEqual([]);
  });

  it("runs each id's step, a failure logged and never keeping the others from theirs", async () => {
    const swept: string[] = [];

    await lifecycle.eachOf(
      ["task-1", "task-2"],
      (id) => `The run environment of the Task ${id}`,
      (id) => {
        swept.push(id);
        return id === "task-1" ? Promise.reject(new Error("stuck")) : Promise.resolve();
      },
    );

    expect(swept).toEqual(["task-1", "task-2"]);
    expect(warn).toHaveBeenCalledWith(
      "The run environment of the Task task-1 wasn't swept.",
      expect.any(Error),
    );
  });
});
