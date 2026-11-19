import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ideaSchema, initiativeSchema, taskSchema } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  READ_STAGE_HISTORY_TOOL,
  READ_THREADS_TOOL,
  READING_OFFICE_TOOLS,
  TaskThreadSetups,
  type TaskThreadRequest,
} from "../../../conversations/index.js";
import { TaskService } from "../../application/task-service.js";
import { confirmPipeline } from "../../domain/planning-changes.js";
import { MOVED_AS_IT_OPENED } from "../../domain/task-move.js";
import { TaskStateChanged } from "../../domain/task-events.js";
import { TaskRepository } from "../../ports/task-repository.js";
import { ProjectWorktreesForTests } from "../../ports/work-ports.fixtures.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";
import { ASKING_OFFICE_TOOLS, PLANNING_OFFICE_TOOLS } from "./task-thread-records.js";
import { withCallingRule } from "./calling-rule.js";
import { askingInstructions } from "../../domain/asking.js";
import { planningInstructions } from "../../domain/planning.js";
import { defaultWorkPrompts } from "../../domain/work-prompt-templates.fixtures.js";
import {
  sendJson,
  startWorkApplication,
  type WorkApplication,
} from "../../work-application.fixtures.js";
import { aPersonsThread, taskThreads } from "../../task-thread-records.fixtures.js";
import { ANN_LEE } from "../../domain/work.fixtures.js";

const prompts = defaultWorkPrompts();
const ASKING_THREAD_INSTRUCTIONS = withCallingRule(askingInstructions(prompts));
const PLANNING_THREAD_INSTRUCTIONS = withCallingRule(planningInstructions(prompts));

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

const { aTaskIn, setups } = taskThreads(() => work);

describe("a person's Thread on a Task's session", () => {
  it("gives a person's Thread and a planning session every reading tool", () => {
    expect(ASKING_OFFICE_TOOLS).toEqual(expect.arrayContaining([...READING_OFFICE_TOOLS]));
    expect(PLANNING_OFFICE_TOOLS).toEqual(expect.arrayContaining([...READING_OFFICE_TOOLS]));
  });

  it("gives a person's Thread reading the Task's Stage history and the Threads", () => {
    expect(ASKING_OFFICE_TOOLS).toContain(READ_STAGE_HISTORY_TOOL);
    expect(ASKING_OFFICE_TOOLS).toContain(READ_THREADS_TOOL);
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

  it.each(["in-progress", "paused"] as const)(
    "gives the Planner the same read-only tools once the Task is %s",
    async (state) => {
      const task = await aTaskIn(state);

      const setup = await setups().of(planningRequest(task.id));

      expect(setup).toMatchObject({
        instructions: ASKING_THREAD_INSTRUCTIONS,
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

  it("opens no person's Thread on a Task that moved to another Project as its worktree was made", async () => {
    const task = await aTaskIn("ready");
    const worktrees = work.app.get(ProjectWorktrees) as ProjectWorktreesForTests;
    const opening = vi.spyOn(worktrees, "open").mockImplementationOnce(async (from, taskId) => {
      await work.app.get(TaskService).move(taskId, `${from}-other`, ANN_LEE);
      return worktrees.find(from, taskId);
    });

    await expect(setups().readyForPersonsThread(task.id)).resolves.toBe(MOVED_AS_IT_OPENED);
    opening.mockRestore();
  });

  it.each([
    ["shaping", "This Task is in Shaping"],
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
    // As Make a plan makes it before the planning Thread opens.
    await work.app.get(ProjectWorktrees).open(projectId, task.id);

    const setup = await work.app.get(TaskThreadSetups).of(planningRequest(task.id));

    expect(setup).toEqual({
      projectId,
      initiativeId: undefined,
      projectName: `The ${projectId}`,
      pipelineName: "",
      folder: join("/worktrees", projectId, task.id),
      environment: { PROJECT: projectId },
      useProjectSkills: true,
      projectSkillsOff: [],
      instructions: PLANNING_THREAD_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      brief: expect.stringContaining(`Fix the login redirect (Task ${task.id})`),
      asking: false,
      sessionRefusal: undefined,
    });
    expect(setup.brief).toContain("- install (Install): `npm install`");
  });

  it("is briefed with the Initiative the Task is part of, its other Tasks and Attachments", async () => {
    const projectId = `project-${randomUUID()}`;
    const idea = ideaSchema.parse(
      await (
        await sendJson(work, "POST", "/ideas", { title: "Usage exports", notes: "", projectId })
      ).json(),
    );
    const initiative = initiativeSchema.parse(
      await (await sendJson(work, "POST", `/ideas/${idea.id}/initiative`)).json(),
    );
    const addTask = async (title: string, blockedBy: readonly string[]) =>
      taskSchema.parse(
        await (
          await sendJson(work, "POST", `/initiatives/${initiative.id}/tasks`, {
            title,
            projectId,
            priority: "normal",
            blockedBy,
          })
        ).json(),
      );
    const endpoint = await addTask("Export endpoint", []);
    const button = await addTask("Export button", [endpoint.id]);

    const setup = await work.app.get(TaskThreadSetups).of(planningRequest(button.id));

    expect(setup.initiativeId).toBe(initiative.id);
    expect(setup.brief).toContain(
      [
        "## Linked records",
        "",
        `- Waits for: Export endpoint (Task ${endpoint.id}), Shaping; read_task reads it`,
        `- Part of: Usage exports (Initiative ${initiative.id}), shaping; read_initiative reads it`,
      ].join("\n"),
    );
    expect(setup.brief).toContain(
      [
        "## The Initiative",
        `This Task is part of Usage exports (Initiative ${initiative.id}), shaping.`,
        "Outcome:\nNot written yet.",
        "Its other Tasks, in the order they were added:",
        `### Export endpoint (Task ${endpoint.id}), in the Project ${projectId}, Shaping\n\nNo Plan yet.`,
        "Attachments:\nNone.",
        "## Attachments",
      ].join("\n\n"),
    );
  });

  it("names the Task's Pipeline for its telemetry, by its id once the Pipeline is gone", async () => {
    const task = await aTaskIn("planning");
    await work.app
      .get(TaskRepository)
      .update(task.id, (latest) => confirmPipeline(latest, "retired-pipeline"));

    const planning = await setups().of(planningRequest(task.id));
    const asking = await setups().of(aPersonsThread(task.id, "oscar"));

    expect(planning).toMatchObject({
      projectName: `The ${task.projectId}`,
      pipelineName: "retired-pipeline",
    });
    expect(asking).toMatchObject({
      initiativeId: undefined,
      projectName: `The ${task.projectId}`,
      pipelineName: "retired-pipeline",
    });
  });

  it.each([
    ["shaping", "This Task is in Shaping"],
    ["done", "This Task is Done"],
    ["dropped", "This Task was dropped"],
  ] as const)("refuses a session while the Task is %s", async (state, words) => {
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
