import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ideaSchema,
  initiativeSchema,
  taskSchema,
  type Initiative,
  type Task,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StartConditionsReader } from "../../application/start-conditions.js";
import { TaskRecords } from "../../application/task-records.js";
import { aProjectId, initiativesHttp } from "../../initiatives.controller.fixtures.js";
import { TaskRepository } from "../../ports/task-repository.js";
import {
  ProjectInitiativeBranchesForTests,
  TaskBasesForTests,
} from "../../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-task-bases-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

const { shape, addTask, post } = initiativesHttp(() => work);

/** A Task of a confirmed Initiative, on `pipelineId` (null for None), and the branch it got. */
async function aTaskOfAnInitiative(
  pipelineId: string | null,
): Promise<{ task: Task; initiative: Initiative; branch: string | undefined }> {
  // A title of its own: Short names are Office-wide.
  const title = `Device names ${randomUUID().slice(0, 8)}`;
  const idea = await sendJson(work, "POST", "/ideas", { title, notes: "", projectId: null });
  const initiative = await shape(ideaSchema.parse(await idea.json()));
  const task = await addTask(initiative, aProjectId());
  const chosen = await sendJson(work, "PUT", `/initiatives/${initiative.id}/pipeline`, {
    pipelineId,
  });
  const { shortName } = initiativeSchema.parse(await chosen.json());
  expect((await post(initiative, "confirm")).status).toBe(200);
  return { task, initiative, branch: shortName === null ? undefined : `initiative/${shortName}` };
}

function lookUp(task: Task) {
  const { lookup } = work.app.get(TaskBasesForTests);
  if (!lookup) throw new Error("Work registered no lookup of a Task's base.");
  return lookup(task.projectId, task.id);
}

describe("ProjectsTaskBaseRegistration", () => {
  it("gives the Initiative's branch of a Task of an Initiative with a Pipeline", async () => {
    const { task, branch } = await aTaskOfAnInitiative("full");

    await expect(lookUp(task)).resolves.toEqual({ kind: "initiative-branch", branch });
    await expect(work.app.get(TaskRecords).read(task.id)).resolves.toMatchObject({
      initiativeBranch: branch,
    });
  });

  it("gives the base branch for a Task of an Initiative on None, and of none", async () => {
    const { task } = await aTaskOfAnInitiative(null);
    const created = await sendJson(work, "POST", "/tasks", {
      title: "Rename a device",
      projectId: aProjectId(),
      priority: "normal",
    });
    const alone = taskSchema.parse(await created.json());

    await expect(lookUp(task)).resolves.toEqual({ kind: "base-branch" });
    await expect(lookUp(alone)).resolves.toEqual({ kind: "base-branch" });
    expect((await work.app.get(TaskRecords).read(task.id)).initiativeBranch).toBeUndefined();
  });
});

describe("StartConditionsReader of an Initiative's Task", () => {
  it("tells Start the Initiative's branch is gone once it is gone from the Project", async () => {
    const { task, branch } = await aTaskOfAnInitiative("full");
    const stored = await work.app.get(TaskRepository).find(task.id);
    if (!stored) throw new Error("The Task wasn't stored.");
    const reader = work.app.get(StartConditionsReader);

    expect((await reader.of(stored)).initiativeBranch).toBeUndefined();
    work.app.get(ProjectInitiativeBranchesForTests).existing.delete(`${task.projectId}/${branch}`);

    expect((await reader.of(stored)).initiativeBranch).toEqual({ kind: "gone", branch });
  });
});
