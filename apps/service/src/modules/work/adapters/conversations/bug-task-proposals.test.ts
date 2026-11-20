import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProposalAppliers, ProposalRefused } from "../../../conversations/index.js";
import { ANN_LEE as ANN_LEE_USER } from "../../../conversations/index.fixtures.js";
import { TaskService } from "../../application/task-service.js";
import type { Task } from "../../domain/task.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { UNKNOWN_PROJECT } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** The Task whose Stage found the Bug, and the one whose work caused it. */
let working: Task;
let cause: Task;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-bug-task-proposals-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  const tasks = work.app.get(TaskService);
  working = await tasks.create(
    { title: "Show pull requests", projectId: "web", priority: "high" },
    ANN_LEE,
  );
  cause = await tasks.create(
    { title: "Refresh GitHub tokens", projectId: "api", priority: "normal" },
    ANN_LEE,
  );
});

afterEach(async () => {
  await work.app.close();
});

const bugTasks = () => work.app.get(ProposalAppliers).bugTask();

describe("Bug Tasks proposed from a Stage", () => {
  it("start in the Project of the Task that found them", async () => {
    expect(await bugTasks().projectOf(working.id)).toBe("web");
    expect(await bugTasks().projectOf(randomUUID())).toBeUndefined();
  });

  it("are judged as proposed: an unknown Project or Caused by Task, and a blank title", async () => {
    expect(
      await bugTasks().problemsWith({
        title: "Two refreshes sign out",
        description: "",
        projectId: "api",
        causedBy: cause.id,
      }),
    ).toEqual([]);
    const missing = randomUUID();
    expect(
      await bugTasks().problemsWith({
        title: " ",
        description: "",
        projectId: UNKNOWN_PROJECT,
        causedBy: missing,
      }),
    ).toEqual([
      expect.any(String),
      `There is no Project "${UNKNOWN_PROJECT}".`,
      `There is no Task ${missing} to have caused it.`,
    ]);
  });

  it("are created in Backlog as Bugs of normal priority, by The Office for the user, found while working on the Task", async () => {
    const made = await bugTasks().create(
      {
        title: "Two refreshes sign out",
        description: "Steps to reproduce",
        projectId: "api",
        causedBy: cause.id,
      },
      working.id,
      ANN_LEE_USER,
    );

    const task = await work.app.get(TaskService).find(made.id);
    expect(made.title).toBe("Two refreshes sign out");
    expect(task).toMatchObject({
      title: "Two refreshes sign out",
      description: "Steps to reproduce",
      projectId: "api",
      state: "backlog",
      kind: "bug",
      priority: "normal",
      createdBy: ANN_LEE,
      createdByTheOffice: true,
      foundWhileWorkingOn: working.id,
      causedBy: cause.id,
    });
  });

  it("are refused, creating nothing, when the Caused by Task is gone", async () => {
    const gone = randomUUID();

    await expect(
      bugTasks().create(
        { title: "Two refreshes sign out", description: "", projectId: "api", causedBy: gone },
        working.id,
        ANN_LEE_USER,
      ),
    ).rejects.toThrow(new ProposalRefused([`There is no Task ${gone}.`]));
  });
});
