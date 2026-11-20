import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conflictResolutionAnswerSchema, workRefusalSchema } from "@the-office/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PipelineLibrary } from "../../pipelines/index.js";
import type { Author } from "../domain/author.js";
import { RESOLVE_CONFLICTS_PIPELINE } from "../domain/conflict-resolution.js";
import type { OverlapChoice } from "../domain/queue.js";
import type { Task } from "../domain/task.js";
import { TaskRefused } from "../domain/task-refused.js";
import { ANN_LEE } from "../domain/work.fixtures.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import {
  KnownProjectsForTests,
  ProjectWorktreesForTests,
  TaskPullRequestsForTests,
} from "../ports/work-ports.fixtures.js";
import type { TaskPullRequest } from "../ports/task-pull-requests.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../work-application.fixtures.js";
import { ConflictResolutions } from "./conflict-resolutions.js";
import { StartService } from "./start-service.js";
import { TaskService } from "./task-service.js";

/** Start as a test answers it: queued, or refused with `refusal`; every call kept. */
class StartForTests {
  readonly starts: { readonly id: string; readonly by: Author }[] = [];
  refusal: readonly string[] | undefined;

  async start(id: string, _onOverlap: OverlapChoice, by: Author): Promise<{ kind: "queued" }> {
    this.starts.push({ id, by });
    if (this.refusal) throw new TaskRefused(this.refusal);
    return { kind: "queued" };
  }
}

let officeData: string;
let work: WorkApplication;
const starting = new StartForTests();

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-conflict-resolutions-"));
  work = await startWorkApplication(officeData, [
    { provide: StartService, useValue: starting },
    {
      provide: KnownPipelines,
      // The library is seeded with the Pipeline apart; here it runs the Test alone.
      useFactory: (library: PipelineLibrary) =>
        Object.assign(Object.create(library) as PipelineLibrary, {
          commandsNamedBy: async (id: string) =>
            id === RESOLVE_CONFLICTS_PIPELINE
              ? { name: "Resolve conflicts", keys: ["test"], hasGate: false, broken: [] }
              : library.commandsNamedBy(id),
        }),
      inject: [PipelineLibrary],
    },
  ]);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

beforeEach(() => {
  starting.starts.length = 0;
  starting.refusal = undefined;
});

/** A Task of a Project of its own, with an open pull request `pullRequest` changes. */
async function aTaskWithAPullRequest(
  pullRequest: Partial<TaskPullRequest> | "none" = {},
): Promise<Task> {
  const projectId = `project-${randomUUID()}`;
  const task = await work.app
    .get(TaskService)
    .create({ title: "Export usage as CSV", projectId, priority: "normal" }, ANN_LEE);
  if (pullRequest !== "none") {
    work.app.get(TaskPullRequestsForTests).open.set(task.id, {
      projectId,
      number: 42,
      url: "https://github.com/acme/billing/pull/42",
      branch: `office/${task.id}`,
      baseBranch: "main",
      mergeable: "conflicts",
      ...pullRequest,
    });
  }
  return task;
}

const resolutions = () => work.app.get(ConflictResolutions);

describe("ConflictResolutions.resolve", () => {
  it("makes a Conflict resolution Task in a worktree of its own and starts it", async () => {
    const original = await aTaskWithAPullRequest();

    const { task, startRefusal } = await resolutions().resolve(original.id, ANN_LEE);

    expect(task).toMatchObject({
      title: "Resolve conflicts: Export usage as CSV",
      projectId: original.projectId,
      state: "ready",
      madeFor: "resolve-conflicts",
      resolvesTaskId: original.id,
      pipelineId: RESOLVE_CONFLICTS_PIPELINE,
      initiativeId: undefined,
    });
    expect(startRefusal).toBeUndefined();
    expect(work.app.get(ProjectWorktreesForTests).opened).toContain(
      `${original.projectId}/${task.id}`,
    );
    expect(starting.starts).toEqual([{ id: task.id, by: ANN_LEE }]);
  });

  it("answers the open Conflict resolution Task on a second press, starting nothing more", async () => {
    const original = await aTaskWithAPullRequest();
    const first = await resolutions().resolve(original.id, ANN_LEE);

    const [second, third] = await Promise.all([
      resolutions().resolve(original.id, ANN_LEE),
      resolutions().resolve(original.id, ANN_LEE),
    ]);

    expect(second.task.id).toBe(first.task.id);
    expect(third.task.id).toBe(first.task.id);
    expect(second.startRefusal).toBeUndefined();
    expect(starting.starts).toHaveLength(1);
  });

  it("refuses a Task with no open pull request", async () => {
    const original = await aTaskWithAPullRequest("none");

    await expect(resolutions().resolve(original.id, ANN_LEE)).rejects.toThrow(
      new TaskRefused(["Export usage as CSV has no open pull request."]),
    );
  });

  it("refuses a pull request with no conflicts, or not worked out yet", async () => {
    const clean = await aTaskWithAPullRequest({ mergeable: "yes" });
    const unknown = await aTaskWithAPullRequest({ mergeable: "unknown" });

    await expect(resolutions().resolve(clean.id, ANN_LEE)).rejects.toThrow(
      new TaskRefused(["Export usage as CSV's pull request #42 has no conflicts to resolve."]),
    );
    await expect(resolutions().resolve(unknown.id, ANN_LEE)).rejects.toThrow(
      "The Office hasn't worked out yet whether Export usage as CSV's pull request #42 has conflicts.",
    );
    expect(await resolutions().openOf(clean.id)).toBeUndefined();
  });

  it("refuses when the Project has no Test command set", async () => {
    const original = await aTaskWithAPullRequest();
    work.app
      .get(KnownProjectsForTests)
      .commands.set(original.projectId, [{ key: "test", name: "Test", commandLine: "" }]);

    await expect(resolutions().resolve(original.id, ANN_LEE)).rejects.toThrow(
      `The Pipeline Resolve conflicts runs test, which The ${original.projectId} has no command for.`,
    );
    expect(await resolutions().openOf(original.id)).toBeUndefined();
  });

  it("refuses while the branch is checked out in the original Task's own worktree, saying so", async () => {
    const original = await aTaskWithAPullRequest();
    work.app.get(ProjectWorktreesForTests).checkouts.set(original.id, {
      branch: `office/${original.id}`,
      checkedOutIn: `/worktrees/${original.id}`,
      inTasksOwnWorktree: true,
    });

    await expect(resolutions().resolve(original.id, ANN_LEE)).rejects.toThrow(
      `The branch office/${original.id} is still checked out in Export usage as CSV's own worktree (/worktrees/${original.id}), so a Conflict resolution Task can't hold it.`,
    );
    expect(await resolutions().openOf(original.id)).toBeUndefined();
  });

  it("refuses while the branch is checked out anywhere else, naming the folder", async () => {
    const original = await aTaskWithAPullRequest();
    work.app.get(ProjectWorktreesForTests).checkouts.set(original.id, {
      branch: `office/${original.id}`,
      checkedOutIn: "/home/ann/billing",
      inTasksOwnWorktree: false,
    });

    await expect(resolutions().resolve(original.id, ANN_LEE)).rejects.toThrow(
      `The branch office/${original.id} is checked out in /home/ann/billing, so a Conflict resolution Task can't hold it.`,
    );
  });

  it("leaves the Task Ready with Start's reasons when Start refuses it", async () => {
    const original = await aTaskWithAPullRequest();
    starting.refusal = ["The fire alarm is on."];

    const { task, startRefusal } = await resolutions().resolve(original.id, ANN_LEE);

    expect(task.state).toBe("ready");
    expect(startRefusal).toEqual(["The fire alarm is on."]);
    expect((await resolutions().openOf(original.id))?.id).toBe(task.id);
  });

  it("throws TaskNotFound for no such Task", async () => {
    await expect(resolutions().resolve(randomUUID(), ANN_LEE)).rejects.toThrow(/There is no Task/);
  });
});

describe("POST /api/tasks/:id/resolve-conflicts", () => {
  it("answers the Conflict resolution Task, and 422 with the reasons when refused", async () => {
    const original = await aTaskWithAPullRequest();
    const clean = await aTaskWithAPullRequest({ mergeable: "yes" });

    const made = await sendJson(work, "POST", `/tasks/${original.id}/resolve-conflicts`);
    const refused = await sendJson(work, "POST", `/tasks/${clean.id}/resolve-conflicts`);

    expect(made.status).toBe(200);
    const answer = conflictResolutionAnswerSchema.parse(await made.json());
    expect(answer).toMatchObject({
      task: { madeFor: "resolve-conflicts", resolvesTaskId: original.id },
      queued: null,
      startRefusal: null,
    });
    expect(refused.status).toBe(422);
    expect(workRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Export usage as CSV's pull request #42 has no conflicts to resolve.",
    ]);
  });
});
