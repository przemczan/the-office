import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProposalAppliers, ProposalRefused } from "../../../conversations/index.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import type { Initiative } from "../../domain/initiative.js";
import type { InitiativeEdit } from "../../domain/initiative-edit.js";
import type { Task } from "../../domain/task.js";
import { TaskDependencyAdded, TaskDependencyRemoved } from "../../domain/task-events.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";
import { ANN_LEE as ANN_LEE_USER } from "../../../conversations/index.fixtures.js";

let officeData: string;
let work: WorkApplication;
/** An active Initiative of the test's own: every test file shares the database. */
let initiative: Initiative;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-initiative-proposals-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  const idea = await work.app
    .get(IdeaService)
    .capture({ title: "Offline sync", notes: "", projectId: undefined }, ANN_LEE);
  const shaped = await work.app.get(InitiativeService).shape(idea.id, ANN_LEE);
  initiative = await work.app.get(InitiativeService).confirm(shaped.id, ANN_LEE);
});

afterEach(async () => {
  await work.app.close();
});

function proposed(edit: InitiativeEdit) {
  return { kind: "initiative", initiativeId: initiative.id, edit } as const;
}

function itsTask(): Promise<Task> {
  return work.app
    .get(InitiativeService)
    .addTask(
      initiative.id,
      { title: "Queue writes", projectId: "api", priority: "normal" },
      [],
      ANN_LEE,
    );
}

function current(): Promise<Initiative> {
  return work.app.get(InitiativeService).read(initiative.id);
}

describe("Proposals of the CTO's changes to an Initiative", () => {
  it("apply the outcome to the active Initiative", async () => {
    const appliers = work.app.get(ProposalAppliers);
    const change = proposed({ kind: "outcome", outcome: "Writes made offline reach the server." });

    expect(await appliers.problemsWith(change)).toEqual([]);
    expect(await appliers.apply(change, "cto", ANN_LEE_USER)).toEqual(change);
    expect((await current()).outcome).toBe("Writes made offline reach the server.");
  });

  it("add the Task in the CTO's name, waiting for its blockers, answering it with its id", async () => {
    const blocker = await work.app
      .get(TaskService)
      .create({ title: "Store the queue", projectId: "web", priority: "normal" }, ANN_LEE);
    const added = {
      kind: "add-task",
      title: "Queue schema",
      projectId: "api",
      priority: "high",
      blockedBy: [blocker.id],
    } as const;
    const change = proposed({ ...added, taskId: undefined });

    const applied = await work.app.get(ProposalAppliers).apply(change, "cto", ANN_LEE_USER);

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(applied).toEqual(proposed({ ...added, taskId: task?.id }));
    expect(task).toMatchObject({
      title: "Queue schema",
      priority: "high",
      blockedBy: [blocker.id],
      createdBy: { kind: "person", roleKey: "cto" },
      description: "",
    });
  });

  it("add the Task with its Description", async () => {
    await work.app.get(ProposalAppliers).apply(
      proposed({
        kind: "add-task",
        title: "Queue schema",
        projectId: "api",
        priority: "normal",
        description: "Writes wait in a table.",
        blockedBy: [],
        taskId: undefined,
      }),
      "cto",
      ANN_LEE_USER,
    );

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(task?.description).toBe("Writes wait in a table.");
  });

  it("rewrite the title and Description of its Task once applied", async () => {
    const appliers = work.app.get(ProposalAppliers);
    const task = await itsTask();
    const title = proposed({ kind: "task-title", taskId: task.id, title: "Keep the queue" });
    const description = proposed({
      kind: "task-description",
      taskId: task.id,
      description: "It survives a restart.",
    });

    expect(await appliers.problemsWith(title)).toEqual([]);
    expect(await appliers.problemsWith(description)).toEqual([]);
    expect(await appliers.apply(title, "cto", ANN_LEE_USER)).toEqual(title);
    expect(await appliers.apply(description, "cto", ANN_LEE_USER)).toEqual(description);
    expect(await work.app.get(TaskService).read(task.id)).toMatchObject({
      title: "Keep the queue",
      description: "It survives a restart.",
    });
  });

  it("hold already once the Task reads as proposed, applying without a change", async () => {
    const task = await itsTask();
    const change = proposed({ kind: "task-title", taskId: task.id, title: task.title });

    expect(await work.app.get(ProposalAppliers).apply(change, "cto", ANN_LEE_USER)).toEqual(change);
  });

  it("are refused a Task's title past Start, as it stands when applied", async () => {
    const appliers = work.app.get(ProposalAppliers);
    const task = await itsTask();
    const change = proposed({ kind: "task-title", taskId: task.id, title: "Keep the queue" });
    await work.app.get(TaskService).drop(task.id, ANN_LEE);
    const reason = "A Task keeps its title once it has started.";

    expect(await appliers.problemsWith(change)).toEqual([reason]);
    await expect(appliers.apply(change, "cto", ANN_LEE_USER)).rejects.toThrow(
      new ProposalRefused([reason]),
    );
    expect((await work.app.get(TaskService).read(task.id)).title).toBe(task.title);
  });

  it("are refused a new Task waiting for a dropped Task, as drafted and as applied", async () => {
    const tasks = work.app.get(TaskService);
    const blocker = await tasks.create(
      { title: "Store the queue", projectId: "web", priority: "normal" },
      ANN_LEE,
    );
    await tasks.drop(blocker.id, ANN_LEE);
    const appliers = work.app.get(ProposalAppliers);
    const change = proposed({
      kind: "add-task",
      title: "Queue schema",
      projectId: "api",
      priority: "normal",
      blockedBy: [blocker.id],
      taskId: undefined,
    });
    const reason = `"Store the queue" was dropped, so nothing waits for it.`;

    expect(await appliers.problemsWith(change)).toEqual([reason]);
    await expect(appliers.apply(change, "cto", ANN_LEE_USER)).rejects.toThrow(
      new ProposalRefused([reason]),
    );
    expect((await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id)).toBe(
      undefined,
    );
  });

  it("are refused once the Initiative is dropped, leaving the Proposal to stay open", async () => {
    const appliers = work.app.get(ProposalAppliers);
    const change = proposed({ kind: "outcome", outcome: "Sync works." });
    await work.app.get(InitiativeService).drop(initiative.id, ANN_LEE);

    expect(await appliers.problemsWith(change)).toEqual([
      "The Initiative is dropped: it changes no more.",
    ]);
    await expect(appliers.apply(change, "cto", ANN_LEE_USER)).rejects.toThrow(
      new ProposalRefused(["The Initiative is dropped: it changes no more."]),
    );
    expect((await current()).outcome).toBe("");
  });

  it("are refused by the dependency rules, as they stand when applied", async () => {
    const tasks = work.app.get(TaskService);
    const task = await work.app
      .get(InitiativeService)
      .addTask(
        initiative.id,
        { title: "Queue writes", projectId: "api", priority: "normal" },
        [],
        ANN_LEE,
      );
    const blocker = await tasks.create(
      { title: "Store the queue", projectId: "web", priority: "normal" },
      ANN_LEE,
    );
    await tasks.addDependency(blocker.id, task.id);

    const cycle = proposed({ kind: "add-dependency", taskId: task.id, blockerId: blocker.id });

    await expect(work.app.get(ProposalAppliers).apply(cycle, "cto", ANN_LEE_USER)).rejects.toThrow(
      ProposalRefused,
    );
    expect((await tasks.read(task.id)).blockedBy).toEqual([]);
  });

  it("take out the direct wait an added one covers, saved and published", async () => {
    const tasks = work.app.get(TaskService);
    const task = await itsTask();
    const schema = await tasks.create(
      { title: "Queue schema", projectId: "api", priority: "normal" },
      ANN_LEE,
    );
    const store = await tasks.create(
      { title: "Store the queue", projectId: "web", priority: "normal" },
      ANN_LEE,
    );
    await tasks.addDependency(store.id, schema.id);
    await tasks.addDependency(task.id, schema.id);
    work.published.length = 0;

    await work.app
      .get(ProposalAppliers)
      .apply(
        proposed({ kind: "add-dependency", taskId: task.id, blockerId: store.id }),
        "cto",
        ANN_LEE_USER,
      );

    expect((await tasks.read(task.id)).blockedBy).toEqual([store.id]);
    expect(
      work.published.flatMap((event) =>
        event instanceof TaskDependencyAdded || event instanceof TaskDependencyRemoved
          ? [{ kind: event.constructor.name, taskId: event.taskId, blockerId: event.blockerId }]
          : [],
      ),
    ).toEqual([
      { kind: "TaskDependencyAdded", taskId: task.id, blockerId: store.id },
      { kind: "TaskDependencyRemoved", taskId: task.id, blockerId: schema.id },
    ]);
  });
});
