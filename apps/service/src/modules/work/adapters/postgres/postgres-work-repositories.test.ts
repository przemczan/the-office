import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Attachment } from "../../domain/attachment.js";
import { moveAttachment } from "../../domain/attachment-changes.js";
import { THE_USER } from "../../domain/author.js";
import { dropIdea, shapeIdeaIntoTask } from "../../domain/idea-changes.js";
import { IdeaNotFound } from "../../domain/idea-not-found.js";
import { boardOrder, orderAfter } from "../../domain/manual-order.js";
import type { Task } from "../../domain/task.js";
import { changePriority, createTask, reorderTask } from "../../domain/task-changes.js";
import { TaskNotFound } from "../../domain/task-not-found.js";
import { aLink, anIdea } from "../../domain/work.fixtures.js";
import { DEFAULT_USAGE_SETTINGS, type UsageSettings } from "../../domain/usage-settings.js";
import { PostgresAttachmentRepository } from "./postgres-attachment-repository.js";
import { PostgresFireAlarmRepository } from "./postgres-fire-alarm-repository.js";
import { PostgresIdeaRepository } from "./postgres-idea-repository.js";
import { PostgresInitiativeRepository } from "./postgres-initiative-repository.js";
import { PostgresTaskRepository } from "./postgres-task-repository.js";
import { PostgresWorkSettings } from "./postgres-work-settings.js";
import { engineCaps, workSettings } from "./work-settings.schema.js";

let app: INestApplication;
let ideas: PostgresIdeaRepository;
let tasks: PostgresTaskRepository;
let attachments: PostgresAttachmentRepository;
let initiatives: PostgresInitiativeRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [
      PostgresIdeaRepository,
      PostgresTaskRepository,
      PostgresAttachmentRepository,
      PostgresInitiativeRepository,
    ],
  }));
  ideas = app.get(PostgresIdeaRepository);
  initiatives = app.get(PostgresInitiativeRepository);
  tasks = app.get(PostgresTaskRepository);
  attachments = app.get(PostgresAttachmentRepository);
});

afterAll(async () => {
  await app.close();
});

/** A Project id of the test's own: every test file shares the database. */
function aProjectId(): string {
  return `project-${randomUUID()}`;
}

/** Creates a Task in the Project, last on the board. */
async function createdTask(projectId: string, fields: Partial<Task> = {}): Promise<Task> {
  const { task } = await tasks.create((takenOrders) =>
    createTask(
      randomUUID(),
      { title: fields.title ?? "A Task", projectId, priority: fields.priority ?? "normal" },
      {
        pipelineId: "full",
        order: orderAfter(takenOrders),
        originIdeaId: undefined,
        initiativeId: undefined,
        createdBy: THE_USER,
      },
      new Date("2026-10-25T10:00:00.000Z"),
    ),
  );
  return task;
}

/** The Project's Tasks as the board shows them. */
async function boardOf(projectId: string): Promise<string[]> {
  return (await tasks.list())
    .filter((task) => task.projectId === projectId)
    .toSorted(boardOrder)
    .map((task) => task.title);
}

describe("PostgresTaskRepository", () => {
  it("keeps a Task as created, each new one last on the board", async () => {
    const projectId = aProjectId();
    const first = await createdTask(projectId, { title: "First" });
    await createdTask(projectId, { title: "Second" });

    await expect(tasks.find(first.id)).resolves.toEqual(first);
    await expect(boardOf(projectId)).resolves.toEqual(["First", "Second"]);
  });

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
  it("keeps an Idea and lists the newest captured first", async () => {
    const older = anIdea({
      id: randomUUID(),
      projectId: undefined,
      capturedAt: new Date("2026-10-25T08:00:00.000Z"),
    });
    const newer = anIdea({ id: randomUUID(), capturedAt: new Date("2030-01-01T08:00:00.000Z") });
    await ideas.add(older);
    await ideas.add(newer);

    await expect(ideas.find(older.id)).resolves.toEqual(older);
    const listed = (await ideas.list()).filter((idea) => [older.id, newer.id].includes(idea.id));
    expect(listed).toEqual([newer, older]);
  });

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

describe("PostgresAttachmentRepository", () => {
  it("keeps links and files of a Task in the order they were added, and removes one", async () => {
    const task = await createdTask(aProjectId());
    const owner = { kind: "task", taskId: task.id } as const;
    const link = aLink({ id: randomUUID(), owner });
    const image: Attachment = {
      id: randomUUID(),
      owner,
      kind: "image",
      name: "screen.png",
      mediaType: "image/png",
      size: 2048,
      addedBy: THE_USER,
      addedAt: new Date("2026-10-25T09:06:00.000Z"),
    };
    await attachments.add(link);
    await attachments.add(image);

    await expect(attachments.find(image.id)).resolves.toEqual(image);
    await expect(attachments.listOf(owner)).resolves.toEqual([link, image]);

    await attachments.remove(link.id);

    await expect(attachments.listOf(owner)).resolves.toEqual([image]);
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

describe("PostgresFireAlarmRepository", () => {
  /** Rolled back: the stored alarm holds every file's Starts, so no test ever leaves it on. */
  class RolledBack extends Error {}

  it("is off as migrated, sounds once, keeping when, and the all clear turns it off once", async () => {
    const since = new Date("2026-10-29T09:00:00.000Z");
    const seen: unknown[] = [];

    await app
      .get<Database>(DATABASE)
      .transaction(async (transaction) => {
        // The transaction offers every query the repository makes.
        const alarm = new PostgresFireAlarmRepository(transaction as unknown as Database);
        seen.push(await alarm.read());
        seen.push(await alarm.sound(since));
        seen.push(await alarm.sound(new Date("2026-10-29T10:00:00.000Z")));
        seen.push(await alarm.read());
        seen.push(await alarm.allClear());
        seen.push(await alarm.allClear());
        seen.push(await alarm.read());
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });

    expect(seen).toEqual([
      { on: false },
      true,
      false,
      { on: true, since },
      true,
      false,
      { on: false },
    ]);
  });
});

describe("PostgresWorkSettings", () => {
  /** Rolled back: every test file's Starts and estimates read the stored settings. */
  class RolledBack extends Error {}

  it("answers the defaults until saved, then keeps the measures and caps apart from the Office-wide limit", async () => {
    const changed: UsageSettings = {
      measures: [],
      caps: [
        {
          engineId: "claude-code",
          windows: { fiveHour: undefined, sevenDay: 80 },
          dailyTokens: 5_000_000,
          dailyDollars: undefined,
        },
        {
          engineId: "openai-compatible-api",
          windows: undefined,
          dailyTokens: undefined,
          dailyDollars: 2.25,
        },
      ],
    };
    const seen: unknown[] = [];

    await app
      .get<Database>(DATABASE)
      .transaction(async (transaction) => {
        await transaction.delete(workSettings);
        await transaction.delete(engineCaps);
        // The transaction offers every query the repository makes.
        const settings = new PostgresWorkSettings(transaction as unknown as Database);
        seen.push(await settings.usageSettings());
        await settings.changeOfficeWideLimit(7);
        await settings.changeUsageSettings(changed);
        seen.push(await settings.usageSettings(), await settings.officeWideLimit());
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });

    expect(seen).toEqual([DEFAULT_USAGE_SETTINGS, changed, 7]);
  });
});
