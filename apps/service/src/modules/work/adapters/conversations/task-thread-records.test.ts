import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_DECISION_TOOL, CONSULT_TOOL, OPEN_DECISION_TOOL } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_WORKTREE_YET } from "../../domain/planning.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";
import { StageResults } from "../../ports/stage-results.js";
import { ProjectWorktreesForTests, StageResultsForTests } from "../../ports/work-ports.fixtures.js";
import { startWorkApplication, type WorkApplication } from "../../work-application.fixtures.js";
import {
  ASKING_OFFICE_TOOLS,
  ASKING_THREAD_INSTRUCTIONS,
  PLANNING_OFFICE_TOOLS,
  PLANNING_THREAD_INSTRUCTIONS,
} from "./task-thread-records.js";
import { aPersonsThread, taskThreads } from "../../task-thread-records.fixtures.js";

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

const { aTaskIn, setups } = taskThreads(() => work);

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
    // As a person's Thread readies the Task as it opens.
    await worktrees.open(task.projectId, task.id);

    const setup = await setups().of(aPersonsThread(task.id, "oscar"));

    expect(setup).toMatchObject({
      folder: join("/worktrees", task.projectId, task.id),
      instructions: ASKING_THREAD_INSTRUCTIONS,
      officeTools: ASKING_OFFICE_TOOLS,
      asking: true,
      sessionRefusal: undefined,
    });
    expect(setup.brief).toContain("Fix the login redirect");
    expect(setup.brief).toContain("- Implement (Agent): done. Fixed it.");
    expect(setup.brief).toContain("2 files changed");
    expect(setup.brief).toContain("Left: the logout page.");
  });

  it("answers a Decision for the user when they ask, as the Planner's Thread does", () => {
    expect(ASKING_OFFICE_TOOLS).toContain(ANSWER_DECISION_TOOL);
    expect(PLANNING_OFFICE_TOOLS).toContain(ANSWER_DECISION_TOOL);
  });

  it("calls another person when the user asks, as the Planner's Thread does", () => {
    expect(ASKING_OFFICE_TOOLS).toContain(CONSULT_TOOL);
    expect(PLANNING_OFFICE_TOOLS).toContain(CONSULT_TOOL);
  });

  it("gives no read-write tool, and no Decision", () => {
    expect(ASKING_OFFICE_TOOLS).toEqual(
      expect.not.arrayContaining([
        OPEN_DECISION_TOOL,
        "write_plan",
        "write_definition_of_done",
        "propose_pipeline",
        "write_tags",
        "mark_planned",
      ]),
    );
  });
});

describe("a Consultation on a Task in Planning with no worktree yet", () => {
  it("reads the Projects' base checkouts instead, its Brief saying so", async () => {
    const task = await aTaskIn("planning");

    const setup = await setups().of({
      taskId: task.id,
      roleKey: "cto",
      personsThread: false,
      firstSession: true,
    });

    expect(setup).toMatchObject({
      projectId: task.projectId,
      folder: undefined,
      branchReads: undefined,
      sessionRefusal: undefined,
    });
    expect(setup.brief).toContain(NO_WORKTREE_YET);
    expect(setup.brief).not.toContain(join("/worktrees", task.projectId, task.id));
  });
});

describe("the Planner's Thread on a Ready Task", () => {
  it("keeps Planning's instructions, tools and Brief, saying what a write does to it", async () => {
    const task = await aTaskIn("ready");

    const setup = await setups().of(aPersonsThread(task.id, "planner"));

    expect(setup).toMatchObject({
      instructions: PLANNING_THREAD_INSTRUCTIONS,
      officeTools: PLANNING_OFFICE_TOOLS,
      asking: false,
      sessionRefusal: undefined,
    });
    expect(setup.brief).toContain("## The Task is Ready");
    expect(setup.brief).toContain("takes it back to Planning");
  });
});
