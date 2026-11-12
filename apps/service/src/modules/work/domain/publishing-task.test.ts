import { describe, expect, it } from "vitest";
import { settleInitiative } from "./initiative-changes.js";
import { initiativePipelineChangeProblems } from "./initiative-pipeline.js";
import {
  createPublishingTask,
  projectsToPublish,
  publishingTaskDefinitionOfDone,
  publishingTaskFiles,
  publishingTaskPlan,
  publishingTaskTitle,
  swapPublishingPipeline,
  type PublishingProject,
} from "./publishing-task.js";
import { blockPublishingTask } from "./task-dependencies.js";
import { TaskDependencyAdded, TaskPipelineConfirmed } from "./task-events.js";
import { moveProblems } from "./task-move.js";
import { initiativeRecordText } from "./record-words.js";
import { anIdea, anInitiative, aTask } from "./work.fixtures.js";

const at = new Date("2026-11-12T10:00:00.000Z");
const madeAt = new Date("2026-11-12T08:00:00.000Z");

const ACTIVE_ON_FULL = anInitiative({
  name: "Usage exports",
  outcome: "Every account can export its usage.",
  state: "active",
  pipelineId: "full",
  shortName: "usage-exports",
  branches: [
    { projectId: "admin-panel", madeAt },
    { projectId: "website", madeAt },
  ],
});

const ADMIN_PANEL: PublishingProject = {
  id: "admin-panel",
  name: "Admin panel",
  baseBranch: "main",
  publishingMode: "merge",
};

const doneIn = (projectId: string, id: string, fields = {}) =>
  aTask({ id, projectId, initiativeId: ACTIVE_ON_FULL.id, state: "done", ...fields });

function publishingTaskIn(projectId: string, state: "ready" | "in-progress" | "done" | "dropped") {
  return aTask({
    id: `publishing-${projectId}-${state}`,
    projectId,
    initiativeId: ACTIVE_ON_FULL.id,
    madeFor: "publishing",
    state,
  });
}

describe("publishingTaskTitle", () => {
  it("names the Initiative and the Project", () => {
    expect(publishingTaskTitle(ACTIVE_ON_FULL, ADMIN_PANEL)).toBe("Usage exports → Admin panel");
  });

  it("cuts a long Initiative's name at a word, so the whole fits a title", () => {
    const name = `${"Export every account's usage ".repeat(5)}today`;

    const title = publishingTaskTitle({ name }, ADMIN_PANEL);

    const cut = title.slice(0, title.indexOf("… → Admin panel"));
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("… → Admin panel")).toBe(true);
    expect(name.startsWith(`${cut} `)).toBe(true);
  });
});

describe("the Publishing Task's words", () => {
  const grounds = {
    initiative: ACTIVE_ON_FULL,
    pipelineName: "Full",
    doneTasks: [doneIn("admin-panel", "t-1", { title: "Add the export button" })],
  };

  it("names the branch, the base, the merge and the Done Tasks in its Plan", () => {
    const plan = publishingTaskPlan(ADMIN_PANEL, grounds);

    expect(plan).toContain("its branch initiative/usage-exports holds the whole change");
    expect(plan).toContain(
      "The base branch is main. Publish puts the branch into it by the base merged in with one merge commit, then main fast-forwarded.",
    );
    expect(plan).toContain("The Task follows the Initiative's Pipeline, Full.");
    expect(plan).toContain("The Initiative's Done Tasks in Admin panel:\n- Add the export button");
  });

  it("names the pull request in a Push + PR Project", () => {
    const plan = publishingTaskPlan(
      { ...ADMIN_PANEL, publishingMode: "push-and-pull-request" },
      grounds,
    );

    expect(plan).toContain(
      "Publish puts the branch into it by a pull request from initiative/usage-exports into main.",
    );
  });

  it("keeps every statement of the Done Tasks once, in order, and then the whole change", () => {
    const tasks = [
      aTask({ definitionOfDone: ["The button shows.", "The file downloads."] }),
      aTask({ definitionOfDone: ["The file downloads.", "The admin sees it."] }),
    ];

    expect(publishingTaskDefinitionOfDone(tasks, ADMIN_PANEL, "initiative/usage-exports")).toEqual([
      "The button shows.",
      "The file downloads.",
      "The admin sees it.",
      "The whole change is in main by the base merged in with one merge commit, then main fast-forwarded.",
    ]);
  });

  it("joins the Done Tasks' Files to change", () => {
    expect(
      publishingTaskFiles([
        aTask({ filesToChange: ["src/export.ts", "src/ui"] }),
        aTask({ filesToChange: ["./src/ui/", "README.md"] }),
      ]),
    ).toEqual(["src/export.ts", "src/ui", "README.md"]);
  });

  it("is made Ready on the Initiative's Pipeline, confirmed, by The Office", () => {
    const { task, stateChange } = createPublishingTask(
      "publishing-1",
      ADMIN_PANEL,
      {
        ...grounds,
        doneTasks: [
          doneIn("admin-panel", "t-1", {
            definitionOfDone: ["The button shows."],
            filesToChange: ["src/export.ts"],
          }),
        ],
      },
      "a5",
      at,
    );

    expect(task).toMatchObject({
      title: "Usage exports → Admin panel",
      projectId: "admin-panel",
      initiativeId: ACTIVE_ON_FULL.id,
      madeFor: "publishing",
      state: "ready",
      pipelineId: "full",
      description: "Every account can export its usage.",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      filesToChange: ["src/export.ts"],
      order: "a5",
      createdBy: ACTIVE_ON_FULL.createdBy,
    });
    expect(task.definitionOfDone[0]).toBe("The button shows.");
    expect(stateChange).toEqual({
      from: undefined,
      to: "ready",
      at,
      by: {
        kind: "office",
        reason:
          "added it as the Initiative's Publishing Task, its Plan, Definition of Done and Pipeline confirmed.",
      },
    });
  });
});

describe("projectsToPublish", () => {
  const everyProject = new Set(["admin-panel", "website"]);
  const ended = [doneIn("admin-panel", "t-1"), doneIn("website", "t-2")];

  it("is each Project with unpublished work once every other Task has ended", () => {
    expect(projectsToPublish(ACTIVE_ON_FULL, ended, everyProject)).toEqual([
      "admin-panel",
      "website",
    ]);
  });

  it("is none for an Initiative on None, or one not active", () => {
    const onNone = { ...ACTIVE_ON_FULL, pipelineId: undefined };

    expect(projectsToPublish(onNone, ended, everyProject)).toEqual([]);
    expect(projectsToPublish({ ...ACTIVE_ON_FULL, state: "dropped" }, ended, everyProject)).toEqual(
      [],
    );
  });

  it("is none while a Task is open", () => {
    const open = [...ended, aTask({ id: "t-3", initiativeId: ACTIVE_ON_FULL.id, state: "ready" })];

    expect(projectsToPublish(ACTIVE_ON_FULL, open, everyProject)).toEqual([]);
  });

  it("leaves out a Project whose Publishing Task is unfinished, and adds one after a Done one", () => {
    const tasks = [
      ...ended,
      publishingTaskIn("admin-panel", "in-progress"),
      publishingTaskIn("website", "done"),
    ];

    expect(projectsToPublish(ACTIVE_ON_FULL, tasks, everyProject)).toEqual(["website"]);
  });

  it("leaves out a Project whose branch holds nothing unpublished", () => {
    expect(projectsToPublish(ACTIVE_ON_FULL, ended, new Set(["website"]))).toEqual(["website"]);
  });
});

function publishingTaskOf(projectId: string) {
  return createPublishingTask(
    `publishing-${projectId}`,
    { ...ADMIN_PANEL, id: projectId },
    { initiative: ACTIVE_ON_FULL, pipelineName: "Full", doneTasks: [] },
    "a9",
    at,
  );
}

describe("settleInitiative", () => {
  it("adds the Publishing Tasks, and the Initiative isn't done until they are", () => {
    const tasks = [doneIn("admin-panel", "t-1")];

    const settled = settleInitiative(
      ACTIVE_ON_FULL,
      tasks,
      new Set(["admin-panel"]),
      publishingTaskOf,
      at,
    );

    expect(settled.created.map(({ task }) => task.title)).toEqual(["Usage exports → Admin panel"]);
    expect(settled.event).toBeUndefined();
    expect(settled.initiative.state).toBe("active");
  });

  it("is done once its Publishing Tasks are Done, and adds none again", () => {
    const tasks = [doneIn("admin-panel", "t-1"), publishingTaskIn("admin-panel", "done")];

    const settled = settleInitiative(ACTIVE_ON_FULL, tasks, new Set(), publishingTaskOf, at);

    expect(settled.created).toEqual([]);
    expect(settled.initiative.state).toBe("done");
  });

  it("adds none for a Project whose Tasks were all Dropped, which leaves it active", () => {
    const dropped = [doneIn("admin-panel", "t-1", { state: "dropped" })];

    const settled = settleInitiative(ACTIVE_ON_FULL, dropped, new Set(), publishingTaskOf, at);

    expect(settled.created).toEqual([]);
    expect(settled.initiative.state).toBe("active");
  });
});

describe("a Publishing Task's own rules", () => {
  const publishing = publishingTaskIn("admin-panel", "in-progress");

  it("can't be moved to another Project", () => {
    expect(moveProblems(publishing, { stateChanges: [], hasWorktree: false })).toEqual([
      "A Publishing Task belongs to its Project, so it can't move to another.",
    ]);
  });

  it("waits for a Task added to its Initiative even once started", () => {
    const fix = aTask({ id: "fix-1", state: "backlog" });

    const blocked = blockPublishingTask(publishing, "fix-1", [publishing, fix]);

    expect(blocked?.task.blockedBy).toEqual(["fix-1"]);
    expect(blocked?.event).toBeInstanceOf(TaskDependencyAdded);
    expect(blockPublishingTask(blocked!.task, "fix-1", [publishing, fix])).toBeUndefined();
  });

  it("doesn't wait for a Task that waits for it", () => {
    const fix = aTask({ id: "fix-1", blockedBy: [publishing.id] });

    expect(blockPublishingTask(publishing, "fix-1", [publishing, fix])).toBeUndefined();
  });

  it("refuses another Pipeline once a Publishing Task has started on the Initiative's", () => {
    expect(
      initiativePipelineChangeProblems(
        ACTIVE_ON_FULL,
        "quick-fix",
        { name: "Quick fix", keys: [], hasGate: false },
        [],
        [{ ...publishing, title: "Usage exports → Admin panel" }],
      ),
    ).toEqual([
      "The Initiative's Pipeline started in Usage exports → Admin panel, so it can't change.",
    ]);
  });

  it("swaps the Pipeline of one not yet started", () => {
    const ready = publishingTaskIn("admin-panel", "ready");

    const swapped = swapPublishingPipeline(ready, "quick-fix");

    expect(swapped?.task.pipelineId).toBe("quick-fix");
    expect(swapped?.event).toEqual(expect.any(TaskPipelineConfirmed));
    expect(swapPublishingPipeline(ready, "full")).toBeUndefined();
    expect(() => swapPublishingPipeline(publishing, "quick-fix")).toThrow(
      "isn't a Publishing Task not yet started",
    );
  });

  it("is listed apart on the Initiative's record, which read_initiative gives", () => {
    const ordinary = doneIn("admin-panel", "t-1", { title: "Add the export button" });
    const added = {
      ...publishingTaskIn("admin-panel", "ready"),
      title: "Usage exports → Admin panel",
    };

    const record = initiativeRecordText({
      initiative: ACTIVE_ON_FULL,
      idea: anIdea({ state: "shaped" }),
      tasks: [ordinary, added],
      blockers: new Map(),
      attachments: [],
    });

    expect(record).toContain(
      `Tasks:\n- Add the export button (Task t-1), in the Project admin-panel, Done\n\nPublishing Tasks, each publishing the whole change in its Project:\n- Usage exports → Admin panel (Task ${added.id}), in the Project admin-panel, Ready`,
    );
  });
});
