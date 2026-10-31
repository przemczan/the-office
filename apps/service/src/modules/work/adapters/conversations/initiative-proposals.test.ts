import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProposalAppliers, ProposalRefused } from "../../../conversations/index.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import { THE_USER } from "../../domain/author.js";
import type { Initiative } from "../../domain/initiative.js";
import type { InitiativeEdit } from "../../domain/initiative-edit.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";

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
    .capture({ title: "Offline sync", notes: "", projectId: undefined }, THE_USER);
  const shaped = await work.app.get(InitiativeService).shape(idea.id, THE_USER);
  initiative = await work.app.get(InitiativeService).confirm(shaped.id);
});

afterEach(async () => {
  await work.app.close();
});

function proposed(edit: InitiativeEdit) {
  return { kind: "initiative", initiativeId: initiative.id, edit } as const;
}

function current(): Promise<Initiative> {
  return work.app.get(InitiativeService).read(initiative.id);
}

describe("Proposals of the CTO's changes to an Initiative", () => {
  it("apply the outcome to the active Initiative", async () => {
    const appliers = work.app.get(ProposalAppliers);
    const change = proposed({ kind: "outcome", outcome: "Writes made offline reach the server." });

    expect(await appliers.problemsWith(change)).toEqual([]);
    expect(await appliers.apply(change, "cto")).toEqual(change);
    expect((await current()).outcome).toBe("Writes made offline reach the server.");
  });

  it("add the Task in the CTO's name, waiting for its blockers, answering it with its id", async () => {
    const blocker = await work.app
      .get(TaskService)
      .create({ title: "Store the queue", projectId: "web", priority: "normal" }, THE_USER);
    const added = {
      kind: "add-task",
      title: "Queue schema",
      projectId: "api",
      priority: "high",
      blockedBy: [blocker.id],
    } as const;
    const change = proposed({ ...added, taskId: undefined });

    const applied = await work.app.get(ProposalAppliers).apply(change, "cto");

    const [task] =
      (await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id) ?? [];
    expect(applied).toEqual(proposed({ ...added, taskId: task?.id }));
    expect(task).toMatchObject({
      title: "Queue schema",
      priority: "high",
      blockedBy: [blocker.id],
      createdBy: { kind: "person", roleKey: "cto" },
    });
  });

  it("are refused a new Task waiting for a dropped Task, as drafted and as applied", async () => {
    const tasks = work.app.get(TaskService);
    const blocker = await tasks.create(
      { title: "Store the queue", projectId: "web", priority: "normal" },
      THE_USER,
    );
    await tasks.drop(blocker.id);
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
    await expect(appliers.apply(change, "cto")).rejects.toThrow(new ProposalRefused([reason]));
    expect((await work.app.get(InitiativeService).tasksByInitiative()).get(initiative.id)).toBe(
      undefined,
    );
  });

  it("are refused once the Initiative is dropped, leaving the Proposal to stay open", async () => {
    const appliers = work.app.get(ProposalAppliers);
    const change = proposed({ kind: "outcome", outcome: "Sync works." });
    await work.app.get(InitiativeService).drop(initiative.id);

    expect(await appliers.problemsWith(change)).toEqual([
      "The Initiative is dropped: it changes no more.",
    ]);
    await expect(appliers.apply(change, "cto")).rejects.toThrow(
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
        THE_USER,
      );
    const blocker = await tasks.create(
      { title: "Store the queue", projectId: "web", priority: "normal" },
      THE_USER,
    );
    await tasks.addDependency(blocker.id, task.id);

    const cycle = proposed({ kind: "add-dependency", taskId: task.id, blockerId: blocker.id });

    await expect(work.app.get(ProposalAppliers).apply(cycle, "cto")).rejects.toThrow(
      ProposalRefused,
    );
    expect((await tasks.read(task.id)).blockedBy).toEqual([]);
  });
});
