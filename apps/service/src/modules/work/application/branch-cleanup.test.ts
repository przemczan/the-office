import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  branchDeletionPreviewSchema,
  branchDeletionRefusalSchema,
  initiativeKnownBranchesSchema,
  taskBranchSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ProjectDeleteMergedBranchesChanged, PullRequestMerged } from "../../projects/index.js";
import type { Initiative } from "../domain/initiative.js";
import { InitiativeCreated, InitiativeStateChanged } from "../domain/initiative-events.js";
import { orderAfter } from "../domain/manual-order.js";
import type { Task, TaskState } from "../domain/task.js";
import { createTask } from "../domain/task-changes.js";
import { TaskBranchDeleted, TaskStateChanged } from "../domain/task-events.js";
import { ANN_LEE, anInitiative } from "../domain/work.fixtures.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { ProjectBranchDeletionsForTests } from "../ports/work-ports.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  webEventsOf,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { BranchCleanup } from "./branch-cleanup.js";

let officeData: string;
let work: WorkApplication;
let projectId: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-branch-cleanup-"));
});

afterAll(async () => {
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(async () => {
  work = await startWorkApplication(officeData);
  projectId = `project-${randomUUID()}`;
});

afterEach(async () => {
  await work.app.close();
});

function deletions(): ProjectBranchDeletionsForTests {
  return work.app.get(ProjectBranchDeletionsForTests);
}

function cleanup(): BranchCleanup {
  return work.app.get(BranchCleanup);
}

async function aTaskIn(state: TaskState, fields: Partial<Task> = {}): Promise<Task> {
  const { task } = await work.app.get(TaskRepository).create((takenOrders) => {
    const creating = createTask(
      randomUUID(),
      { title: "Fix the login redirect", projectId, priority: "normal" },
      {
        order: orderAfter(takenOrders),
        originIdeaId: undefined,
        initiativeId: undefined,
        createdBy: ANN_LEE,
      },
      new Date("2026-11-20T09:00:00.000Z"),
    );
    return { ...creating, task: { ...creating.task, state, ...fields } };
  });
  return task;
}

/** A Task's branch the repository knows, judged safe unless a test says otherwise. */
function knownBranchOf(task: Task): string {
  const branch = `office/${task.id}`;
  deletions().known.add(`${projectId}/${branch}`);
  return branch;
}

async function moveToDone(task: Task): Promise<void> {
  const { event } = await work.app.get(TaskRepository).update(task.id, (held) => ({
    task: { ...held, state: "done" },
    event: new TaskStateChanged(held.id, held.state, "done"),
  }));
  if (event === undefined) throw new Error(`The Task ${task.id} didn't change.`);
  await work.app.get(EventBus).publish(event);
  await cleanup().idle();
}

async function anInitiativeIn(state: Initiative["state"]): Promise<Initiative> {
  const initiative = anInitiative({
    id: randomUUID(),
    name: `Exports ${randomUUID()}`,
    state,
    originIdeaId: undefined,
    shortName: `exports-${randomUUID().slice(0, 8)}`,
    pipelines: [{ projectId, pipelineId: "initiative" }],
    branches: [{ projectId, madeAt: new Date("2026-11-20T08:00:00.000Z") }],
  });
  await work.app
    .get(InitiativeRepository)
    .insert({ initiative, event: new InitiativeCreated(initiative) });
  return initiative;
}

function merged(taskId: string): PullRequestMerged {
  return new PullRequestMerged(
    randomUUID(),
    projectId,
    taskId,
    12,
    "https://github.com/acme/admin-panel/pull/12",
    "squash",
    { kind: "code-host", name: "GitHub" },
    new Date("2026-11-20T10:00:00.000Z"),
  );
}

describe("BranchCleanup, automatically", () => {
  it("deletes a Done Task's safe branch with the setting On, and records it", async () => {
    deletions().on.add(projectId);
    const task = await aTaskIn("in-progress");
    const branch = knownBranchOf(task);

    await moveToDone(task);

    expect(deletions().deleted).toEqual([`${projectId}/${branch}`]);
    const kept = await work.app.get(TaskRepository).find(task.id);
    expect(kept?.branchDeletion).toMatchObject({
      branch,
      copies: [
        { kind: "local", name: branch },
        { kind: "remote", name: `origin/${branch}` },
      ],
      by: { kind: "office" },
    });
    expect(webEventsOf(work)).toContainEqual({ type: "task.branch-deleted", taskId: task.id });
  });

  it("leaves it with the setting Off", async () => {
    const task = await aTaskIn("in-progress");
    knownBranchOf(task);

    await moveToDone(task);

    expect(deletions().judged).toEqual([]);
    expect(deletions().deleted).toEqual([]);
  });

  it("never deletes a branch holding work the base lacks, or one refused, nor records it", async () => {
    deletions().on.add(projectId);
    const holding = await aTaskIn("in-progress");
    const refused = await aTaskIn("in-progress");
    deletions().judgements.set(`${projectId}/${knownBranchOf(holding)}`, {
      holdsWork: { commitCount: 2, subjects: ["Add the export"], unpublishedTaskTitles: [] },
    });
    deletions().judgements.set(`${projectId}/${knownBranchOf(refused)}`, {
      refusal: "Merge or close its pull request first.",
    });

    await moveToDone(holding);
    await moveToDone(refused);

    expect(deletions().deleted).toEqual([]);
    expect(work.published.some((event) => event instanceof TaskBranchDeleted)).toBe(false);
  });

  it("deletes a Done Task's branch once its pull request merged, but not a Dropped one's", async () => {
    const done = await aTaskIn("done");
    const dropped = await aTaskIn("dropped");
    const doneBranch = knownBranchOf(done);
    knownBranchOf(dropped);
    deletions().on.add(projectId);

    await work.app.get(EventBus).publish(merged(done.id));
    await work.app.get(EventBus).publish(merged(dropped.id));
    await cleanup().idle();

    expect(deletions().deleted).toEqual([`${projectId}/${doneBranch}`]);
  });

  it("deletes a Done Initiative's branch, judged with its Publishing Task and its Tasks", async () => {
    deletions().on.add(projectId);
    const initiative = await anInitiativeIn("active");
    const branch = `initiative/${initiative.shortName}`;
    deletions().known.add(`${projectId}/${branch}`);
    const task = await aTaskIn("done", { initiativeId: initiative.id, title: "Add the export" });
    const publishing = await aTaskIn("done", {
      initiativeId: initiative.id,
      madeFor: "publishing",
      endedAt: new Date("2026-11-20T11:00:00.000Z"),
    });
    await work.app.get(InitiativeRepository).update(initiative.id, (held) => ({
      initiative: { ...held, state: "done" },
      event: new InitiativeStateChanged(held.id, held.state, "done"),
    }));

    await work.app
      .get(EventBus)
      .publish(new InitiativeStateChanged(initiative.id, "active", "done"));
    await cleanup().idle();

    expect(deletions().judged.at(-1)).toEqual({
      key: `${projectId}/${branch}`,
      owner: {
        kind: "initiative",
        publishingTaskId: publishing.id,
        tasks: [{ taskId: task.id, title: "Add the export" }],
      },
    });
    expect(deletions().deleted).toEqual([`${projectId}/${branch}`]);
    const kept = await work.app.get(InitiativeRepository).find(initiative.id);
    expect(kept?.branches[0]?.deletion).toMatchObject({ branch, by: { kind: "office" } });
    expect(webEventsOf(work)).toContainEqual({
      type: "initiative.branch-deleted",
      initiativeId: initiative.id,
      projectId,
    });
  });

  it("never deletes a Dropped Initiative's branch", async () => {
    deletions().on.add(projectId);
    const initiative = await anInitiativeIn("dropped");
    deletions().known.add(`${projectId}/initiative/${initiative.shortName}`);

    await cleanup().sweep(projectId);

    expect(deletions().deleted).toEqual([]);
  });
});

describe("BranchCleanup's sweep", () => {
  it("deletes the safe leftovers of Done Tasks once the setting is turned On, nothing else", async () => {
    const done = await aTaskIn("done");
    const going = await aTaskIn("in-progress");
    const doneBranch = knownBranchOf(done);
    knownBranchOf(going);
    deletions().known.add(`${projectId}/office/${randomUUID()}`);
    deletions().known.add(`${projectId}/feature/login`);
    deletions().known.add(`${projectId}/initiative/nobody-knows`);

    await cleanup().sweepAll();
    expect(deletions().deleted).toEqual([]);

    deletions().on.add(projectId);
    await work.app.get(EventBus).publish(new ProjectDeleteMergedBranchesChanged(projectId, true));
    await cleanup().idle();

    expect(deletions().deleted).toEqual([`${projectId}/${doneBranch}`]);
  });

  it("runs every hour", async () => {
    const task = await aTaskIn("done");
    const branch = knownBranchOf(task);
    deletions().on.add(projectId);

    cleanup().start();
    await cleanup().sweepAll();

    expect(deletions().deleted).toEqual([`${projectId}/${branch}`]);
  });
});

describe("Delete branch… on a Task", () => {
  it("answers the Task's branch and whether it is known here", async () => {
    const task = await aTaskIn("done");
    const publishing = await aTaskIn("done", { madeFor: "publishing" });

    const unknown = await sendJson(work, "GET", `/tasks/${task.id}/branch`);
    knownBranchOf(task);
    const known = await sendJson(work, "GET", `/tasks/${task.id}/branch`);
    const none = await sendJson(work, "GET", `/tasks/${publishing.id}/branch`);

    expect(taskBranchSchema.parse(await unknown.json())).toEqual({
      branch: { projectId, branch: `office/${task.id}`, known: false },
    });
    expect(taskBranchSchema.parse(await known.json()).branch?.known).toBe(true);
    expect(taskBranchSchema.parse(await none.json())).toEqual({ branch: null });
  });

  it("previews and deletes a Dropped Task's branch holding work, by the user, with Delete anyway", async () => {
    const task = await aTaskIn("dropped");
    const branch = knownBranchOf(task);
    deletions().judgements.set(`${projectId}/${branch}`, {
      holdsWork: { commitCount: 1, subjects: ["Try a redirect"], unpublishedTaskTitles: [] },
    });

    const preview = branchDeletionPreviewSchema.parse(
      await (await sendJson(work, "GET", `/tasks/${task.id}/branch-deletion`)).json(),
    );
    expect(preview).toMatchObject({ branch, refusal: null, holdsWork: { commitCount: 1 } });
    const expected = preview.copies.map(({ kind, commit }) => ({ kind, commit }));

    const refused = await sendJson(work, "POST", `/tasks/${task.id}/branch-deletion`, {
      expected,
      deleteUnmerged: false,
    });
    expect(refused.status).toBe(409);
    const deleted = await sendJson(work, "POST", `/tasks/${task.id}/branch-deletion`, {
      expected,
      deleteUnmerged: true,
    });

    expect(deleted.status).toBe(204);
    const kept = await work.app.get(TaskRepository).find(task.id);
    expect(kept?.branchDeletion?.by).toMatchObject({ kind: "user" });
  });

  it("refuses while the Task hasn't ended, the judgement's refusal, and a branch that moved", async () => {
    const going = await aTaskIn("in-progress");
    const withPullRequest = await aTaskIn("done");
    const moved = await aTaskIn("done");
    knownBranchOf(going);
    deletions().judgements.set(`${projectId}/${knownBranchOf(withPullRequest)}`, {
      refusal: "Merge or close its pull request first.",
    });
    knownBranchOf(moved);
    const request = {
      expected: [{ kind: "local", commit: "an-older-commit" }],
      deleteUnmerged: false,
    };

    const preview = branchDeletionPreviewSchema.parse(
      await (await sendJson(work, "GET", `/tasks/${going.id}/branch-deletion`)).json(),
    );
    const reasons = await Promise.all(
      [going, withPullRequest, moved].map(async (task) => {
        const response = await sendJson(work, "POST", `/tasks/${task.id}/branch-deletion`, request);
        expect(response.status).toBe(409);
        return branchDeletionRefusalSchema.parse(await response.json()).reason;
      }),
    );

    expect(preview.refusal).toBe("The Task isn't Done or Dropped, so its branch stays.");
    expect(reasons).toEqual([
      "The Task isn't Done or Dropped, so its branch stays.",
      "Merge or close its pull request first.",
      "The branch changed since it was checked; check again.",
    ]);
    expect(deletions().deleted).toEqual([]);
  });
});

describe("Delete branch… on an Initiative", () => {
  it("lists its branches, and refuses while one of its Tasks there hasn't ended", async () => {
    const initiative = await anInitiativeIn("dropped");
    const branch = `initiative/${initiative.shortName}`;
    deletions().known.add(`${projectId}/${branch}`);
    await aTaskIn("in-progress", { initiativeId: initiative.id, title: "Add the export" });

    const branches = initiativeKnownBranchesSchema.parse(
      await (await sendJson(work, "GET", `/initiatives/${initiative.id}/branches`)).json(),
    );
    const preview = branchDeletionPreviewSchema.parse(
      await (
        await sendJson(
          work,
          "GET",
          `/initiatives/${initiative.id}/projects/${projectId}/branch-deletion`,
        )
      ).json(),
    );

    expect(branches).toEqual({ branches: [{ projectId, branch, known: true }] });
    expect(preview.refusal).toBe('The Task "Add the export" hasn\'t ended, so the branch stays.');
  });

  it("deletes a Dropped Initiative's branch by hand and records it on its branch", async () => {
    const initiative = await anInitiativeIn("dropped");
    const branch = `initiative/${initiative.shortName}`;
    deletions().known.add(`${projectId}/${branch}`);
    const path = `/initiatives/${initiative.id}/projects/${projectId}/branch-deletion`;
    const preview = branchDeletionPreviewSchema.parse(
      await (await sendJson(work, "GET", path)).json(),
    );

    const response = await sendJson(work, "POST", path, {
      expected: preview.copies.map(({ kind, commit }) => ({ kind, commit })),
      deleteUnmerged: false,
    });

    expect(response.status).toBe(204);
    expect(deletions().deleted).toEqual([`${projectId}/${branch}`]);
    const kept = await work.app.get(InitiativeRepository).find(initiative.id);
    expect(kept?.branches[0]?.deletion?.by).toMatchObject({ kind: "user" });
  });
});
