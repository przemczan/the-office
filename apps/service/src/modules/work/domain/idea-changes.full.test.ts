import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import {
  attachingToIdeaProblems,
  captureIdea,
  dropIdea,
  restoreIdea,
  shapeIdeaIntoInitiative,
  shapeIdeaIntoTask,
} from "./idea-changes.js";
import {
  IdeaCaptured,
  IdeaDropped,
  IdeaRestored,
  IdeaShaped,
  IdeaShapedIntoInitiative,
} from "./idea-events.js";
import { IdeaRefused } from "./idea-refused.js";
import { InitiativeCreated } from "./initiative-events.js";
import { TaskCreated } from "./task-events.js";
import { anIdea, anInitiative, aTask } from "./work.fixtures.js";

const at = new Date("2026-10-25T11:00:00.000Z");

describe("captureIdea", () => {
  it("keeps what the user typed without its surrounding spaces, as a new Idea", () => {
    const { idea, event } = captureIdea(
      "idea-1",
      {
        title: " Export usage as CSV ",
        notes: " Monthly, per Project, for the accountant. ",
        projectId: "admin-panel",
      },
      THE_USER,
      anIdea().capturedAt,
    );

    expect(idea).toEqual(anIdea());
    expect(event).toEqual(new IdeaCaptured(idea));
  });

  it("captures an Idea Office-wide, by a person", () => {
    const planner = { kind: "person", roleKey: "planner" } as const;

    const { idea } = captureIdea(
      "idea-2",
      { title: "Nightly updates", notes: "", projectId: undefined },
      planner,
      at,
    );

    expect(idea).toMatchObject({ projectId: undefined, capturedBy: planner });
  });

  it("refuses an Idea without a title", () => {
    expect(() =>
      captureIdea("idea-2", { title: "", notes: "Something", projectId: undefined }, THE_USER, at),
    ).toThrow(new IdeaRefused(["Give the Idea a title."]));
  });
});

describe("shapeIdeaIntoTask", () => {
  const setting = { order: "a4", createdBy: THE_USER };

  it("makes a Task in Backlog named after the Idea, its notes the Description, with the Idea as its origin and no Pipeline yet", () => {
    const { ideaShaped, taskCreated } = shapeIdeaIntoTask(
      anIdea({ projectId: undefined }),
      { id: "task-7", projectId: "admin-panel" },
      setting,
      at,
    );

    expect(taskCreated.task).toEqual(
      aTask({
        id: "task-7",
        title: "Export usage as CSV",
        description: "Monthly, per Project, for the accountant.",
        order: "a4",
        pipelineId: undefined,
        originIdeaId: "idea-1",
        createdAt: at,
      }),
    );
    expect(taskCreated.event).toEqual(new TaskCreated(taskCreated.task));
    expect(ideaShaped.idea).toEqual(
      anIdea({ state: "shaped", projectId: "admin-panel", taskId: "task-7" }),
    );
    expect(ideaShaped.event).toEqual(new IdeaShaped("idea-1", "admin-panel", "task-7", at));
  });

  it("refuses a shaped or dropped Idea", () => {
    const task = { id: "task-7", projectId: "admin-panel" };
    expect(() => shapeIdeaIntoTask(anIdea({ state: "shaped" }), task, setting, at)).toThrow(
      new IdeaRefused(["This Idea is already shaped."]),
    );
    expect(() => shapeIdeaIntoTask(anIdea({ state: "dropped" }), task, setting, at)).toThrow(
      new IdeaRefused(["A dropped Idea can't be shaped; restore it first."]),
    );
  });
});

describe("shapeIdeaIntoInitiative", () => {
  it("makes an Initiative being shaped, named after the Idea, which keeps its Project", () => {
    const shaping = shapeIdeaIntoInitiative(
      anIdea({ title: "Usage exports" }),
      "initiative-1",
      THE_USER,
      anInitiative().createdAt,
    );

    expect(shaping.initiativeCreated.initiative).toEqual(anInitiative());
    expect(shaping.initiativeCreated.event).toEqual(new InitiativeCreated(anInitiative()));
    expect(shaping.ideaShaped.idea).toEqual(
      anIdea({ title: "Usage exports", state: "shaped", initiativeId: "initiative-1" }),
    );
    expect(shaping.ideaShaped.event).toEqual(
      new IdeaShapedIntoInitiative("idea-1", "initiative-1", anInitiative().createdAt),
    );
  });

  it("refuses a shaped or dropped Idea", () => {
    expect(() =>
      shapeIdeaIntoInitiative(anIdea({ state: "shaped" }), "initiative-1", THE_USER, at),
    ).toThrow(new IdeaRefused(["This Idea is already shaped."]));
    expect(() =>
      shapeIdeaIntoInitiative(anIdea({ state: "dropped" }), "initiative-1", THE_USER, at),
    ).toThrow(new IdeaRefused(["A dropped Idea can't be shaped; restore it first."]));
  });
});

describe("dropIdea", () => {
  it("keeps a dropped Idea with when it was dropped", () => {
    const change = dropIdea(anIdea(), at);

    expect(change?.idea).toEqual(anIdea({ state: "dropped", droppedAt: at }));
    expect(change?.event).toEqual(new IdeaDropped("idea-1", at));
  });

  it("changes nothing for a dropped Idea and refuses a shaped one", () => {
    expect(dropIdea(anIdea({ state: "dropped", droppedAt: at }), at)).toBeUndefined();
    expect(() => dropIdea(anIdea({ state: "shaped" }), at)).toThrow(
      new IdeaRefused(["A shaped Idea can't be dropped; drop its Task instead."]),
    );
    expect(() => dropIdea(anIdea({ state: "shaped", initiativeId: "initiative-1" }), at)).toThrow(
      new IdeaRefused(["A shaped Idea can't be dropped; drop its Initiative instead."]),
    );
  });
});

describe("restoreIdea", () => {
  it("brings a dropped Idea back among the new ones", () => {
    const change = restoreIdea(anIdea({ state: "dropped", droppedAt: at }));

    expect(change?.idea).toEqual(anIdea());
    expect(change?.event).toBeInstanceOf(IdeaRestored);
    expect(change?.event).toMatchObject({ ideaId: "idea-1" });
  });

  it("changes nothing for a new Idea and refuses a shaped one", () => {
    expect(restoreIdea(anIdea())).toBeUndefined();
    expect(() => restoreIdea(anIdea({ state: "shaped" }))).toThrow(IdeaRefused);
  });
});

describe("attachingToIdeaProblems", () => {
  it("sends Attachments for a shaped Idea to what it became", () => {
    expect(attachingToIdeaProblems(anIdea())).toEqual([]);
    expect(attachingToIdeaProblems(anIdea({ state: "dropped" }))).toEqual([]);
    expect(attachingToIdeaProblems(anIdea({ state: "shaped" }))).toEqual([
      "This Idea was shaped into a Task; add the Attachment to the Task.",
    ]);
    expect(
      attachingToIdeaProblems(anIdea({ state: "shaped", initiativeId: "initiative-1" })),
    ).toEqual(["This Idea was shaped into an Initiative; add the Attachment to the Initiative."]);
  });
});
