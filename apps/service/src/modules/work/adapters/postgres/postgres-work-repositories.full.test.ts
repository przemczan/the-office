import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { asc, eq, inArray, sql, TransactionRollbackError, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../../../platform/database/database.js";
import { moveAttachment } from "../../domain/attachment-changes.js";
import { THE_USER } from "../../domain/author.js";
import { dropIdea, shapeIdeaIntoTask } from "../../domain/idea-changes.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { confirmInitiative } from "../../domain/initiative-changes.js";
import { InitiativeStateChanged } from "../../domain/initiative-events.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import { InitiativeRefused } from "../../domain/initiative-refused.js";
import { boardOrder, orderAfter } from "../../domain/manual-order.js";
import type { BoardFilters } from "../../domain/saved-view.js";
import type { Task } from "../../domain/task.js";
import { changePriority, createTask, reorderTask } from "../../domain/task-changes.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { aLink, anIdea } from "../../domain/work.fixtures.js";
import { PostgresAttachmentRepository } from "./postgres-attachment-repository.js";
import { PostgresIdeaRepository } from "./postgres-idea-repository.js";
import { PostgresInitiativeRepository } from "./postgres-initiative-repository.js";
import { PostgresTaskRepository } from "./postgres-task-repository.js";
import { savedViews } from "./saved-views.schema.js";
import {
  initiatives as initiativeRows,
  tasks as taskRows,
  taskStateChanges,
} from "./work.schema.js";
import {
  aProjectId,
  startWorkRepositories,
  workRecords,
} from "./postgres-work-repositories.fixtures.js";

let app: INestApplication;
let ideas: PostgresIdeaRepository;
let tasks: PostgresTaskRepository;
let attachments: PostgresAttachmentRepository;
let initiatives: PostgresInitiativeRepository;
let database: Database;

beforeAll(async () => {
  ({ app, ideas, initiatives, tasks, attachments, database } = await startWorkRepositories());
});

afterAll(async () => {
  await app.close();
});

const { createdTask, anInitiativeId, boardOf } = workRecords(() => ({ ideas, tasks }));

describe("PostgresTaskRepository", () => {
  it("applies a change and saves nothing when it changes nothing", async () => {
    const task = await createdTask(aProjectId());

    const changed = await tasks.update(task.id, (stored) => changePriority(stored, "high"));
    const unchanged = await tasks.update(task.id, (stored) => changePriority(stored, "high"));

    expect(changed.task.priority).toBe("high");
    expect(unchanged).toEqual({ task: changed.task, event: undefined });
    await expect(tasks.find(task.id)).resolves.toEqual(changed.task);
  });

  it("reorders a Task between its neighbours as stored", async () => {
    const projectId = aProjectId();
    const first = await createdTask(projectId, { title: "First" });
    const second = await createdTask(projectId, { title: "Second" });
    const third = await createdTask(projectId, { title: "Third" });

    await tasks.reorder(third.id, { above: first.id, below: second.id }, reorderTask);

    await expect(boardOf(projectId)).resolves.toEqual(["First", "Third", "Second"]);
  });

  it("creates a Task last after one moved to the top took a key Postgres would sort differently", async () => {
    const projectId = aProjectId();
    const top = await createdTask(projectId, { title: "Top" });
    const moved = await createdTask(projectId, { title: "Moved" });
    // A key before the board's first can take an upper-case head, which sorts after lower case in
    // Postgres's default collation but before it in code.
    const board = (await tasks.list())
      .toSorted(boardOrder)
      // Backlog's column only: other files' Tasks in other states may sort first.
      .filter((task) => task.state === "backlog" && task.priority === "normal");
    await tasks.reorder(moved.id, { above: undefined, below: board[0]?.id }, reorderTask);
    const created = await createdTask(projectId, { title: "Created" });

    expect(created.order > top.order).toBe(true);
    await expect(boardOf(projectId)).resolves.toEqual(["Moved", "Top", "Created"]);
  });

  it("refuses an unknown Task or neighbour", async () => {
    const task = await createdTask(aProjectId());
    const missing = randomUUID();

    await expect(tasks.update(missing, (stored) => changePriority(stored, "low"))).rejects.toThrow(
      new TaskNotFound(missing),
    );
    await expect(
      tasks.reorder(task.id, { above: missing, below: undefined }, reorderTask),
    ).rejects.toThrow(new TaskNotFound(missing));
  });

  it("knows no Task by an id that isn't a uuid, such as one an Agent mistyped", async () => {
    expect(await tasks.find("task-7")).toBeUndefined();
    await expect(tasks.update("task-7", (stored) => changePriority(stored, "low"))).rejects.toThrow(
      new TaskNotFound("task-7"),
    );
  });
});

describe("PostgresIdeaRepository", () => {
  it("applies a change to the Idea as stored", async () => {
    const idea = anIdea({ id: randomUUID() });
    await ideas.add(idea);
    const at = new Date("2026-10-25T12:00:00.000Z");

    const { idea: dropped } = await ideas.update(idea.id, (stored) => dropIdea(stored, at));

    await expect(ideas.find(idea.id)).resolves.toEqual(dropped);
    expect(dropped).toMatchObject({ state: "dropped", droppedAt: at });
  });

  it("shapes an Idea into a Task, moving its Attachments, all at once", async () => {
    const projectId = aProjectId();
    const idea = anIdea({ id: randomUUID(), projectId });
    await ideas.add(idea);
    const link = aLink({ id: randomUUID(), owner: { kind: "idea", ideaId: idea.id } });
    await attachments.add(link);
    const taskId = randomUUID();

    const shaped = await ideas.shape(idea.id, (stored, storedAttachments, takenOrders) => ({
      ...shapeIdeaIntoTask(
        stored,
        { id: taskId, projectId },
        { pipelineId: "full", order: orderAfter(takenOrders), createdBy: THE_USER },
        new Date("2026-10-25T12:00:00.000Z"),
      ),
      moves: storedAttachments.map((attachment) =>
        moveAttachment(attachment, { kind: "task", taskId }),
      ),
    }));

    await expect(ideas.find(idea.id)).resolves.toEqual(shaped.ideaShaped.idea);
    await expect(tasks.find(taskId)).resolves.toEqual(shaped.taskCreated.task);
    await expect(attachments.listOf({ kind: "task", taskId })).resolves.toEqual([
      { ...link, owner: { kind: "task", taskId } },
    ]);
    await expect(attachments.listOf({ kind: "idea", ideaId: idea.id })).resolves.toEqual([]);
  });

  it("saves nothing of a shaping that fails", async () => {
    const idea = anIdea({ id: randomUUID(), state: "shaped" });
    await ideas.add(idea);
    const taskId = randomUUID();

    await expect(
      ideas.shape(idea.id, (stored) => ({
        ...shapeIdeaIntoTask(
          stored,
          { id: taskId, projectId: "admin-panel" },
          { pipelineId: "full", order: "a0", createdBy: THE_USER },
          new Date(),
        ),
        moves: [],
      })),
    ).rejects.toThrow("This Idea is already shaped.");
    await expect(tasks.find(taskId)).resolves.toBeUndefined();
  });

  it("refuses an unknown Idea", async () => {
    const missing = randomUUID();

    await expect(ideas.update(missing, (stored) => dropIdea(stored, new Date()))).rejects.toThrow(
      new IdeaNotFound(missing),
    );
  });

  it("knows no Idea or Initiative by an id that isn't a uuid", async () => {
    expect(await ideas.find("idea-7")).toBeUndefined();
    await expect(ideas.update("idea-7", (stored) => dropIdea(stored, new Date()))).rejects.toThrow(
      new IdeaNotFound("idea-7"),
    );
    expect(await initiatives.find("initiative-7")).toBeUndefined();
  });
});

describe("PostgresInitiativeRepository", () => {
  it("refuses an unknown Initiative or Task", async () => {
    const task = await createdTask(aProjectId());
    const initiativeId = await anInitiativeId();
    const missing = randomUUID();

    await expect(initiatives.changeTask(missing, task.id, () => undefined)).rejects.toThrow(
      new InitiativeNotFound(missing),
    );
    await expect(initiatives.changeTask(initiativeId, missing, () => undefined)).rejects.toThrow(
      new TaskNotFound(missing),
    );
  });
});

/** What `read` found, with its changes undone: every test file shares the record. */
async function rolledBack<Result>(
  read: (transaction: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<Result>,
): Promise<Result> {
  let result: Result | undefined;
  await database
    .transaction(async (transaction) => {
      result = await read(transaction);
      transaction.rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof TransactionRollbackError)) throw error;
    });
  if (result === undefined) throw new Error("Nothing was read.");
  return result;
}

/** A Task of the Initiative in `state`, its creation kept. */
async function aTaskOf(initiativeId: string, state: Task["state"]): Promise<Task> {
  const task = await createdTask(aProjectId());
  await database.update(taskRows).set({ initiativeId, state }).where(eq(taskRows.id, task.id));
  return { ...task, initiativeId, state };
}

function rowOf(task: Task): SQL | undefined {
  return eq(taskRows.id, task.id);
}

describe("PostgresInitiativeRepository.updateWithTasks", () => {
  it("saves the Initiative and its Tasks' moves together, keeping each move", async () => {
    const initiativeId = await anInitiativeId();
    const shaping = await aTaskOf(initiativeId, "shaping");
    const planning = await aTaskOf(initiativeId, "planning");

    const { initiative, taskChanges } = await initiatives.updateWithTasks(
      initiativeId,
      confirmInitiative,
    );

    expect(initiative.state).toBe("active");
    expect(taskChanges.map(({ task }) => task.id)).toEqual([shaping.id]);
    expect((await tasks.find(shaping.id))?.state).toBe("backlog");
    expect((await tasks.find(planning.id))?.state).toBe("planning");
    expect((await tasks.stateChangesOf(shaping.id)).at(-1)).toMatchObject({
      from: "shaping",
      to: "backlog",
      by: THE_USER,
    });
  });

  it("saves nothing when a change is refused or changes nothing", async () => {
    const initiativeId = await anInitiativeId();
    const shaping = await aTaskOf(initiativeId, "shaping");
    await initiatives.update(initiativeId, (initiative) => ({
      initiative: { ...initiative, state: "active" },
      event: new InitiativeStateChanged(initiativeId, "shaping", "active"),
    }));

    await expect(initiatives.updateWithTasks(initiativeId, confirmInitiative)).rejects.toThrow(
      InitiativeRefused,
    );
    await expect(initiatives.updateWithTasks(initiativeId, () => undefined)).resolves.toMatchObject(
      { event: undefined, taskChanges: [] },
    );
    expect((await tasks.find(shaping.id))?.state).toBe("shaping");
  });

  it("refuses an unknown Initiative", async () => {
    const missing = randomUUID();

    await expect(initiatives.updateWithTasks(missing, () => undefined)).rejects.toThrow(
      new InitiativeNotFound(missing),
    );
  });
});

describe("migration 0096", () => {
  it("moves the Backlog Tasks of shaping Initiatives to Shaping, the move in their records", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0096_tasks_in_shaping.sql", import.meta.url),
      "utf8",
    );
    const shaping = await anInitiativeId();
    const active = await anInitiativeId();
    const backlog = await createdTask(aProjectId());
    const planning = await createdTask(aProjectId());
    const ofActive = await createdTask(aProjectId());
    const outside = await createdTask(aProjectId());

    const after = await rolledBack(async (transaction) => {
      await transaction
        .update(initiativeRows)
        .set({ state: "active" })
        .where(eq(initiativeRows.id, active));
      await transaction.update(taskRows).set({ initiativeId: shaping }).where(rowOf(backlog));
      await transaction
        .update(taskRows)
        .set({ initiativeId: shaping, state: "planning" })
        .where(rowOf(planning));
      await transaction.update(taskRows).set({ initiativeId: active }).where(rowOf(ofActive));
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const stateOf = async (task: Task) =>
        (await transaction.select().from(taskRows).where(rowOf(task)))[0]?.state;
      const movesOf = (task: Task) =>
        transaction
          .select()
          .from(taskStateChanges)
          .where(eq(taskStateChanges.taskId, task.id))
          .orderBy(asc(taskStateChanges.id));
      return {
        states: [
          await stateOf(backlog),
          await stateOf(planning),
          await stateOf(ofActive),
          await stateOf(outside),
        ],
        backlogMoves: await movesOf(backlog),
        planningMoves: await movesOf(planning),
      };
    });

    expect(after.states).toEqual(["shaping", "planning", "backlog", "backlog"]);
    expect(after.backlogMoves.at(-1)).toMatchObject({
      fromState: "backlog",
      toState: "shaping",
      changedBy: { kind: "office", reason: "its Initiative is still being shaped" },
    });
    expect(after.planningMoves).toHaveLength(1);
  });
});

/** A row of a Task's move, as the user made it. */
function move(task: Task, from: Task["state"], to: Task["state"], at: Date) {
  return { taskId: task.id, fromState: from, toState: to, changedAt: at, changedBy: THE_USER };
}

describe("migration 0110", () => {
  it("dates each ended Initiative's end by its Tasks' moves where one dates it", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0110_initiative_ended_at.sql", import.meta.url),
      "utf8",
    );
    const [done, droppedShaping, droppedActive, active] = [
      await anInitiativeId(),
      await anInitiativeId(),
      await anInitiativeId(),
      await anInitiativeId(),
    ];
    const earlier = new Date("2026-09-01T10:00:00.000Z");
    const later = new Date("2026-09-03T10:00:00.000Z");
    const dropMoment = new Date("2026-09-05T10:00:00.000Z");
    const doneTask = await aTaskOf(done, "done");
    const droppedTask = await aTaskOf(done, "dropped");
    const shapingTask = await aTaskOf(droppedShaping, "dropped");
    const leftTask = await aTaskOf(droppedActive, "dropped");
    const activeTask = await aTaskOf(active, "done");

    const endedAt = await rolledBack(async (transaction) => {
      for (const [id, state] of [
        [done, "done"],
        [droppedShaping, "dropped"],
        [droppedActive, "dropped"],
        [active, "active"],
      ] as const) {
        await transaction.update(initiativeRows).set({ state }).where(eq(initiativeRows.id, id));
      }
      await transaction.insert(taskStateChanges).values([
        move(doneTask, "in-progress", "done", earlier),
        move(droppedTask, "backlog", "dropped", later),
        move(shapingTask, "shaping", "dropped", dropMoment),
        // Dropped by the user on its own, before its Initiative dropped while Active.
        move(leftTask, "backlog", "dropped", earlier),
        move(activeTask, "in-progress", "done", later),
      ]);
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      const rows = await transaction
        .select({ id: initiativeRows.id, endedAt: initiativeRows.endedAt })
        .from(initiativeRows)
        .where(inArray(initiativeRows.id, [done, droppedShaping, droppedActive, active]));
      return new Map(rows.map((row) => [row.id, row.endedAt]));
    });

    expect(endedAt.get(done)).toEqual(later);
    expect(endedAt.get(droppedShaping)).toEqual(dropMoment);
    expect(endedAt.get(droppedActive)).toBeNull();
    expect(endedAt.get(active)).toBeNull();
  });
});

const aSavedView = (filters: BoardFilters & { readonly tags?: readonly string[] }) => ({
  id: randomUUID(),
  name: `View ${randomUUID()}`,
  filters,
  savedAt: new Date(),
});

describe("migration 0097", () => {
  it("takes Tags out of the Saved views, removing those left with no filters", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0097_saved_views_without_tags.sql", import.meta.url),
      "utf8",
    );
    const onlyTags = aSavedView({ tags: ["ble"] });
    const tagsAndOthers = aSavedView({ tags: ["ble"], priority: "high", blocked: true });
    const noTags = aSavedView({ query: "flash" });

    const after = await rolledBack(async (transaction) => {
      await transaction.insert(savedViews).values([onlyTags, tagsAndOthers, noTags]);
      for (const statement of migration.split("--> statement-breakpoint")) {
        await transaction.execute(sql.raw(statement));
      }
      return transaction
        .select()
        .from(savedViews)
        .where(inArray(savedViews.id, [onlyTags.id, tagsAndOthers.id, noTags.id]));
    });

    expect(after).toHaveLength(2);
    expect(after).toContainEqual(
      expect.objectContaining({
        name: tagsAndOthers.name,
        filters: { priority: "high", blocked: true },
      }),
    );
    expect(after).toContainEqual(
      expect.objectContaining({ name: noTags.name, filters: { query: "flash" } }),
    );
  });
});

describe("work tables", () => {
  it("refuse two Tasks with one order key", async () => {
    const task = await createdTask(aProjectId());

    await expect(
      tasks.create(() =>
        createTask(
          randomUUID(),
          { title: "Twin", projectId: task.projectId, priority: "normal" },
          {
            pipelineId: "full",
            order: task.order,
            originIdeaId: undefined,
            initiativeId: undefined,
            createdBy: THE_USER,
          },
          new Date(),
        ),
      ),
    ).rejects.toMatchObject({ cause: { constraint: "tasks_order_key" } });
  });
});
