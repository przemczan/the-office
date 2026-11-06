import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPEN_DECISION_TOOL, taskSchema, type Task, type TaskState } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaskThreadSetups, type TaskThreadRequest } from "../../../conversations/index.js";
import { PLANNING_INSTRUCTIONS } from "../../domain/planning.js";
import { TaskStateChanged } from "../../domain/task-events.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { StageResults } from "../../ports/stage-results.js";
import { ProjectWorktreesForTests, StageResultsForTests } from "../../ports/work-ports.fixtures.js";
import { ASKING_INSTRUCTIONS } from "../../domain/asking.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";
import { ASKING_OFFICE_TOOLS, PLANNING_OFFICE_TOOLS } from "./task-thread-records.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";

let officeData: string;
let work: WorkApplication;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-planning-setup-"));
  work = await startWorkApplication(officeData);
});

afterAll(async () => {
  await work.app.close();
  await rm(officeData, { recursive: true, force: true });
});

/** The Planner's own Thread on the Task, no session in it yet. */
function planningRequest(taskId: string): TaskThreadRequest {
  return aPersonsThread(taskId, "planner");
}

function aPersonsThread(taskId: string, roleKey: string, firstSession = true): TaskThreadRequest {
  return { taskId, roleKey, personsThread: true, firstSession };
}

async function aTaskIn(state: TaskState): Promise<Task> {
  const created = await sendJson(work, "POST", "/tasks", {
    title: "Fix the login redirect",
    projectId: `project-${randomUUID()}`,
    priority: "normal",
  });
  const task = taskSchema.parse(await created.json());
  await work.app.get(TaskRepository).update(task.id, (latest) => ({
    task: { ...latest, state },
    event: new TaskStateChanged(latest.id, latest.state, state),
  }));
  return task;
}

function setups(): TaskThreadSetups {
  return work.app.get(TaskThreadSetups);
}

describe("a person's Thread on a Task's session", () => {
  it("reads the Task's worktree with read-only tools, briefed from the record", async () => {
    const task = await aTaskIn("waiting-on-you");
    const results = work.app.get(StageResults) as StageResultsForTests;
    results.results.set(`${task.id}/oscar`, {
      lines: ["- Implement (Agent): done. Fixed it."],
      handoverNotes: ["Left: the logout page."],
    });
    const worktrees = work.app.get(ProjectWorktrees) as ProjectWorktreesForTests;
    worktrees.changes.set(task.id, "2 files changed");

    const setup = await setups().of(aPersonsThread(task.id, "oscar"));

    expect(setup).toMatchObject({
      folder: join("/worktrees", task.projectId, task.id),
      instructions: ASKING_INSTRUCTIONS,
      officeTools: ASKING_OFFICE_TOOLS,
      asking: true,
      sessionRefusal: undefined,
    });
    expect(setup.brief).toContain("Fix the login redirect");
    expect(setup.brief).toContain("- Implement (Agent): done. Fixed it.");
    expect(setup.brief).toContain("2 files changed");
    expect(setup.brief).toContain("Left: the logout page.");
  });

  it("gives no read-write tool, and no Decision", () => {
    expect(ASKING_OFFICE_TOOLS).toEqual(
      expect.not.arrayContaining([
        OPEN_DECISION_TOOL,
        "write_plan",
        "write_definition_of_done",
        "propose_pipeline",
        "write_tags",
      ]),
    );
  });

  it("leaves out a diff it can't read, keeping the Thread readable", async () => {
    const task = await aTaskIn("in-progress");
    const worktrees = work.app.get(ProjectWorktrees) as ProjectWorktreesForTests;
    worktrees.changesFailure = new Error("spawn git ENOENT");

    const setup = await setups().of(aPersonsThread(task.id, "oscar"));
    worktrees.changesFailure = undefined;

    expect(setup.brief).toContain("Fix the login redirect");
    expect(setup.brief).not.toContain("## What changed so far");
  });

  it("gives a later session no record, so the Context policy briefs it", async () => {
    const task = await aTaskIn("in-progress");

    const setup = await setups().of(aPersonsThread(task.id, "oscar", false));

    expect(setup).toMatchObject({ asking: true, brief: undefined });
  });

  it.each(["ready", "in-progress", "paused"] as const)(
    "gives the Planner the same read-only tools once the Task is %s",
    async (state) => {
      const task = await aTaskIn(state);

      const setup = await setups().of(planningRequest(task.id));

      expect(setup).toMatchObject({
        instructions: ASKING_INSTRUCTIONS,
        officeTools: ASKING_OFFICE_TOOLS,
      });
    },
  );

  it("leaves a Consultation's and a Stage's Threads as they were", async () => {
    const task = await aTaskIn("in-progress");

    const setup = await setups().of({
      ...aPersonsThread(task.id, "cto"),
      personsThread: false,
    });

    expect(setup).toMatchObject({ officeTools: PLANNING_OFFICE_TOOLS, asking: false });
  });

  it("makes the worktree of a Task marked Ready from Backlog as its Thread opens", async () => {
    const task = await aTaskIn("ready");
    const worktrees = work.app.get(ProjectWorktrees) as ProjectWorktreesForTests;

    await expect(setups().readyForPersonsThread(task.id)).resolves.toBeUndefined();

    expect(worktrees.opened).toContain(`${task.projectId}/${task.id}`);
  });

  it.each([
    ["backlog", "This Task is in Backlog"],
    ["done", "This Task is Done"],
    ["dropped", "This Task was dropped"],
  ] as const)("opens no person's Thread on a Task in %s", async (state, words) => {
    const task = await aTaskIn(state);

    await expect(setups().readyForPersonsThread(task.id)).resolves.toContain(words);
  });
});

describe("a planning Thread's session", () => {
  it("works in the Task's worktree with the Project's environment and skills, briefed from the record", async () => {
    const projectId = `project-${randomUUID()}`;
    const created = await sendJson(work, "POST", "/tasks", {
      title: "Fix the login redirect",
      projectId,
      priority: "normal",
    });
    const task = taskSchema.parse(await created.json());

    const setup = await work.app.get(TaskThreadSetups).of(planningRequest(task.id));

    expect(setup).toEqual({
      projectId,
      folder: join("/worktrees", projectId, task.id),
      environment: { PROJECT: projectId },
      useProjectSkills: true,
      projectSkillsOff: [],
      instructions: PLANNING_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      brief: expect.stringContaining(`Fix the login redirect (Task ${task.id})`),
      asking: false,
      sessionRefusal: undefined,
    });
    expect(setup.brief).toContain("- install: `npm install`");
  });

  it.each([
    ["done", "This Task is Done"],
    ["dropped", "This Task was dropped"],
  ] as const)("refuses a session once the Task is %s", async (state, words) => {
    const created = await sendJson(work, "POST", "/tasks", {
      title: "Ship the redirect",
      projectId: `project-${randomUUID()}`,
      priority: "normal",
    });
    const task = taskSchema.parse(await created.json());
    await work.app.get(TaskRepository).update(task.id, (latest) => ({
      task: { ...latest, state },
      event: new TaskStateChanged(latest.id, latest.state, state),
    }));

    const setup = await work.app.get(TaskThreadSetups).of(planningRequest(task.id));

    // The Thread's label and Brief still read the setup, so only a session is refused.
    expect(setup.sessionRefusal).toContain(words);
    expect(setup.brief).toContain("Ship the redirect");
  });
});
