import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Attachment } from "../../domain/attachment.js";
import { createConflictResolutionTask } from "../../domain/conflict-resolution.js";
import { orderAfter } from "../../domain/manual-order.js";
import { confirmPipeline } from "../../domain/planning-changes.js";
import type { Task } from "../../domain/task.js";
import { changeTaskState } from "../../domain/task-changes.js";
import { changeCommitMessage, publishCommitMessage } from "../../domain/task-commit-message.js";
import { changeTitle } from "../../domain/task-description.js";
import { TaskCommitMessageChanged } from "../../domain/task-events.js";
import {
  clearPullRequestEnd,
  recordPullRequestEnd,
  type PullRequestEnd,
} from "../../domain/task-pull-request.js";
import { ANN_LEE, aLink, anIdea } from "../../domain/work.fixtures.js";
import { DEFAULT_USAGE_SETTINGS, type UsageSettings } from "../../domain/usage-settings.js";
import { PostgresAttachmentRepository } from "./postgres-attachment-repository.js";
import { heldFireAlarm, PostgresFireAlarmRepository } from "./postgres-fire-alarm-repository.js";
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

  it("keeps the Stand-in Engines a Task's Start chose, none until one is", async () => {
    const created = await createdTask(aProjectId());
    expect(created.engineStandIns).toEqual([]);
    const engineStandIns = [
      {
        engineId: "work",
        standInId: "personal",
        engineName: "Work",
        standInName: "Personal",
        reason: "The Work engine's 5-hour window would pass its 80% cap.",
        short: "5-hour window near its cap",
      },
    ];

    // Start sets them with the Task's state; any change carries them as the repository keeps it.
    await tasks.update(created.id, (task) => ({
      task: { ...task, engineStandIns },
      event: new TaskCommitMessageChanged(task.id),
    }));

    await expect(tasks.find(created.id)).resolves.toMatchObject({ engineStandIns });
  });

  it("keeps how a Task's pull request ended, by a user or on the code host, until it is cleared", async () => {
    const created = await createdTask(aProjectId());
    expect(created.pullRequestEnd).toBeUndefined();
    const merged: PullRequestEnd = {
      outcome: "merged",
      number: 12,
      url: "https://github.com/acme/admin-panel/pull/12",
      at: new Date("2026-11-19T10:00:00.000Z"),
      method: "squash",
      by: ANN_LEE,
    };
    const closed: PullRequestEnd = {
      ...merged,
      outcome: "closed",
      method: undefined,
      by: { kind: "code-host", name: "GitHub" },
    };

    await tasks.update(created.id, (task) => recordPullRequestEnd(task, merged));
    await expect(tasks.find(created.id)).resolves.toMatchObject({ pullRequestEnd: merged });
    await tasks.update(created.id, (task) => recordPullRequestEnd(task, closed));
    await expect(tasks.find(created.id)).resolves.toMatchObject({ pullRequestEnd: closed });
    await tasks.update(created.id, (task) => clearPullRequestEnd(task, 12, new Date()));
    await expect(tasks.find(created.id)).resolves.toMatchObject({ pullRequestEnd: undefined });
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

  it("is off as migrated, sounds once, keeping when, is made stricter only, and the all clear turns it off once", async () => {
    const since = new Date("2026-10-29T09:00:00.000Z");
    const later = new Date("2026-10-29T10:00:00.000Z");
    const seen: unknown[] = [];

    await app
      .get<Database>(DATABASE)
      .transaction(async (transaction) => {
        // The transaction offers every query the repository makes.
        const alarm = new PostgresFireAlarmRepository(transaction as unknown as Database);
        seen.push(await alarm.read());
        seen.push(await alarm.sound(since, "after-tasks"));
        seen.push(await alarm.sound(later, "after-tasks"));
        seen.push(await alarm.sound(later, "after-stages"));
        seen.push(await alarm.read());
        // As the hold of Starts reads it, on the transaction it holds.
        seen.push(await heldFireAlarm(transaction));
        seen.push(await alarm.sound(later, "after-tasks"));
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
      "turned-on",
      "unchanged",
      "made-stricter",
      { on: true, since, way: "after-stages" },
      { on: true, since, way: "after-stages" },
      "refused",
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

/** A Conflict resolution Task of `original`'s pull request, last on the board. */
function aConflictResolution(original: Task) {
  return tasks.create((takenOrders) =>
    createConflictResolutionTask(
      randomUUID(),
      original,
      {
        projectId: original.projectId,
        number: 42,
        url: "https://github.com/acme/billing/pull/42",
        branch: `office/${original.id}`,
        baseBranch: "main",
      },
      { order: orderAfter(takenOrders), createdBy: ANN_LEE },
      new Date("2026-11-19T10:00:00.000Z"),
    ),
  );
}

describe("Conflict resolution Tasks", () => {
  it("keeps the Task it resolves, and refuses a second open one for that Task", async () => {
    const original = await createdTask(aProjectId());
    const { task } = await aConflictResolution(original);

    await expect(tasks.find(task.id)).resolves.toEqual(task);
    expect(task.resolvesTaskId).toBe(original.id);
    await expect(aConflictResolution(original)).rejects.toMatchObject({
      cause: { constraint: "tasks_open_conflict_resolution_per_task" },
    });
  });

  it("takes another once the open one is Dropped", async () => {
    const original = await createdTask(aProjectId());
    const { task } = await aConflictResolution(original);
    await tasks.update(task.id, (stored) => changeTaskState(stored, "dropped", ANN_LEE));

    const { task: again } = await aConflictResolution(original);

    expect(again.resolvesTaskId).toBe(original.id);
  });
});
