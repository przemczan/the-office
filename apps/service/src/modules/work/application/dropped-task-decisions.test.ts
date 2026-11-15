import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TaskStateChanged } from "../domain/task-events.js";
import { initiativesHttp } from "../initiatives.controller.fixtures.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskDecisionsForTests } from "../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { DroppedTaskDecisions } from "./dropped-task-decisions.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-dropped-task-decisions-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
});

afterEach(async () => {
  await work.app.close();
});

const { capture, shape, addTask, post, end } = initiativesHttp(() => work);

function closedOn(): readonly string[] {
  return work.app.get(TaskDecisionsForTests).closedOn;
}

describe("a dropped Task's open Decisions", () => {
  it("are closed as the user drops the Task", async () => {
    const initiative = await shape(await capture());
    const task = await addTask(initiative);
    await post(initiative, "confirm");

    expect((await sendJson(work, "POST", `/tasks/${task.id}/drop`)).status).toBe(200);

    expect(closedOn()).toEqual([task.id]);
  });

  it("are closed for each Task an Initiative's Drop takes along, and not for one already Done", async () => {
    const initiative = await shape(await capture());
    const backlog = await addTask(initiative);
    const done = await addTask(initiative);
    await post(initiative, "confirm");
    await end(done, "done");

    await post(initiative, "drop");

    expect(closedOn()).toEqual([backlog.id]);
  });

  it("are left as they are on any other move", async () => {
    const initiative = await shape(await capture());
    const task = await addTask(initiative);
    await post(initiative, "confirm");

    await end(task, "done");

    expect(closedOn()).toEqual([]);
  });

  it("are closed at the start on Tasks dropped before, and on no other", async () => {
    const initiative = await shape(await capture());
    const dropped = await addTask(initiative);
    const backlog = await addTask(initiative);
    await post(initiative, "confirm");
    // As a Drop before the rule left it: the Task Dropped, its Decisions open.
    await work.app.get(TaskRepository).update(dropped.id, (held) => ({
      task: { ...held, state: "dropped" },
      event: new TaskStateChanged(held.id, held.state, "dropped"),
    }));
    expect(closedOn()).toEqual([]);

    await work.app.get(DroppedTaskDecisions).closeLeftOpen();

    // Every file's Tasks share the database, so others' dropped Tasks are closed on too.
    expect(closedOn()).toContain(dropped.id);
    expect(closedOn()).not.toContain(backlog.id);
  });
});
