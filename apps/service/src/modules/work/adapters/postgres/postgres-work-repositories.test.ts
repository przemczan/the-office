import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Attachment } from "../../domain/attachment.js";
import { confirmPipeline } from "../../domain/planning-changes.js";
import { changeCommitMessage, publishCommitMessage } from "../../domain/task-commit-message.js";
import { changeTitle } from "../../domain/task-description.js";
import { ANN_LEE, aLink, anIdea } from "../../domain/work.fixtures.js";
import { DEFAULT_USAGE_SETTINGS, type UsageSettings } from "../../domain/usage-settings.js";
import { PostgresAttachmentRepository } from "./postgres-attachment-repository.js";
import { PostgresFireAlarmRepository } from "./postgres-fire-alarm-repository.js";
import { PostgresIdeaRepository } from "./postgres-idea-repository.js";
import { PostgresInitiativeRepository } from "./postgres-initiative-repository.js";
import { PostgresTaskRepository } from "./postgres-task-repository.js";
import { PostgresWorkSettings } from "./postgres-work-settings.js";
import { engineCaps, workSettings } from "./work-settings.schema.js";
import { taskStateChanges } from "./work.schema.js";
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

beforeAll(async () => {
  ({ app, ideas, initiatives, tasks, attachments } = await startWorkRepositories());
});

afterAll(async () => {
  await app.close();
});

const { createdTask, anInitiativeId, boardOf } = workRecords(() => ({ ideas, tasks }));

describe("PostgresTaskRepository", () => {
  it("keeps a Task as created, each new one last on the board", async () => {
    const projectId = aProjectId();
    const first = await createdTask(projectId, {
      title: "First",
      description: "Land on the page I came from.",
    });
    await createdTask(projectId, { title: "Second" });

    await expect(tasks.find(first.id)).resolves.toEqual(first);
    await expect(boardOf(projectId)).resolves.toEqual(["First", "Second"]);
  });

  it("keeps a Task with no Pipeline until one is chosen", async () => {
    const created = await createdTask(aProjectId());
    await expect(tasks.find(created.id)).resolves.toMatchObject({ pipelineId: undefined });

    await tasks.update(created.id, (task) => confirmPipeline(task, "quick-fix"));

    await expect(tasks.find(created.id)).resolves.toMatchObject({ pipelineId: "quick-fix" });
  });

  it("keeps a Task's commit message, empty until written, and when Publish landed it", async () => {
    const created = await createdTask(aProjectId());
    const publishedAt = new Date("2026-11-15T10:00:00.000Z");
    expect(created).toMatchObject({ commitMessage: "", commitMessagePublishedAt: undefined });

    await tasks.update(created.id, (task) => changeCommitMessage(task, "feat: rename\n\nBody."));
    await tasks.update(created.id, (task) => publishCommitMessage(task, publishedAt));

    await expect(tasks.find(created.id)).resolves.toMatchObject({
      commitMessage: "feat: rename\n\nBody.",
      commitMessagePublishedAt: publishedAt,
    });
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
});

describe("PostgresInitiativeRepository", () => {
  it("changes a Task with the Initiative as held, and saves nothing when it changes nothing", async () => {
    const initiativeId = await anInitiativeId();
    const task = await createdTask(aProjectId(), { title: "Queue writes" });
    const seen: string[] = [];

    const changed = await initiatives.changeTask(initiativeId, task.id, (initiative, stored) => {
      seen.push(initiative.id);
      return changeTitle(stored, "Keep the queue");
    });
    const unchanged = await initiatives.changeTask(initiativeId, task.id, (_, stored) =>
      changeTitle(stored, "Keep the queue"),
    );

    expect(seen).toEqual([initiativeId]);
    expect(changed.task.title).toBe("Keep the queue");
    expect(unchanged).toEqual({ task: changed.task, event: undefined });
    await expect(tasks.find(task.id)).resolves.toEqual(changed.task);
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
      text: false,
      sourcePath: ".office/screenshots/screen.png",
      addedBy: { kind: "person", roleKey: "developer" },
      addedAt: new Date("2026-10-25T09:06:00.000Z"),
    };
    await attachments.add(link);
    await attachments.add(image);

    await expect(attachments.find(image.id)).resolves.toEqual(image);
    await expect(attachments.listOf(owner)).resolves.toEqual([link, image]);

    await attachments.remove(link.id);

    await expect(attachments.listOf(owner)).resolves.toEqual([image]);
  });

  it("keeps a file's new copy over its record, its document text replaced", async () => {
    const task = await createdTask(aProjectId());
    const owner = { kind: "task", taskId: task.id } as const;
    const design: Attachment = {
      id: randomUUID(),
      owner,
      kind: "file",
      name: "design.html",
      mediaType: "text/html",
      size: 100,
      text: true,
      sourcePath: "docs/design.html",
      addedBy: { kind: "person", roleKey: "designer" },
      addedAt: new Date("2026-10-25T09:06:00.000Z"),
    };
    await attachments.add(design);
    const copy = {
      ...design,
      size: 120,
      addedBy: { kind: "person", roleKey: "developer" },
    } as const;

    await attachments.replace(copy);

    await expect(attachments.listOf(owner)).resolves.toEqual([copy]);
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

  it("answers the defaults until saved, keeps the measures and caps apart from the Office-wide limit, and forgets one engine's caps; auto mode is off until saved", async () => {
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
          engineId: "lab",
          windows: undefined,
          dailyTokens: undefined,
          dailyDollars: 2.25,
        },
      ],
    };
    // Which engine has windows is for the Engine module's engines to say: kept, none are set.
    const kept: UsageSettings = {
      ...changed,
      caps: changed.caps.map((caps) => ({
        ...caps,
        windows: caps.windows ?? { fiveHour: undefined, sevenDay: undefined },
      })),
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
        await settings.forgetEngineCaps("lab");
        seen.push(await settings.usageSettings(), await settings.autoMode());
        await settings.changeAutoMode(true);
        seen.push(await settings.autoMode(), await settings.officeWideLimit());
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });

    const withoutLab: UsageSettings = { ...kept, caps: kept.caps.slice(0, 1) };
    expect(seen).toEqual([DEFAULT_USAGE_SETTINGS, kept, 7, withoutLab, false, true, 7]);
  });
});

function move(taskId: string, toState: "done" | "in-progress", changedAt: Date) {
  return {
    taskId,
    fromState: "in-progress" as const,
    toState,
    changedAt,
    changedBy: ANN_LEE,
  };
}

describe("PostgresTaskRepository.doneSince", () => {
  it("gives each Task moved to Done at or after the moment once, archived or moved on since", async () => {
    const database = app.get<Database>(DATABASE);
    const projectId = aProjectId();
    const [twice, atTheMoment, before, notDone] = [
      await createdTask(projectId),
      await createdTask(projectId),
      await createdTask(projectId),
      await createdTask(projectId),
    ];
    const since = new Date("2099-03-02T00:00:00.000Z");
    await database
      .insert(taskStateChanges)
      .values([
        move(twice.id, "done", new Date("2099-03-02T08:00:00.000Z")),
        move(twice.id, "done", new Date("2099-03-03T08:00:00.000Z")),
        move(atTheMoment.id, "done", since),
        move(before.id, "done", new Date("2099-03-01T23:59:59.000Z")),
        move(notDone.id, "in-progress", new Date("2099-03-02T09:00:00.000Z")),
      ]);
    const ours = new Set([twice.id, atTheMoment.id, before.id, notDone.id]);

    const done = (await tasks.doneSince(since)).filter((taskId) => ours.has(taskId));

    expect(done.toSorted()).toEqual([twice.id, atTheMoment.id].toSorted());
  });
});
