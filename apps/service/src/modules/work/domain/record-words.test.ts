import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import type { TaskLinks } from "./linked-records.js";
import {
  ideaRecordText,
  initiativeRecordText,
  taskRecordText,
  type TaskRecordParts,
} from "./record-words.js";
import { anIdea, anInitiative, aTask } from "./work.fixtures.js";

const NO_LINKS: TaskLinks = {
  waitsFor: [],
  waitingForIt: [],
  idea: undefined,
  initiative: undefined,
};

const NOTHING: TaskRecordParts = {
  attachments: [],
  links: NO_LINKS,
  stageResults: { lines: [], handoverNotes: [] },
  stateChanges: [],
};

const ARCHIVED_AT = new Date("2026-11-01T10:00:00.000Z");

/** The lines of one part of a record, from its heading to the blank line after it. */
function part(record: string, heading: string): string[] {
  const lines = record.split("\n");
  const start = lines.indexOf(heading);
  const end = lines.indexOf("", start);
  return lines.slice(start, end === -1 ? undefined : end);
}

describe("taskRecordText", () => {
  it("names each Move to another Project, oldest first", () => {
    const task = aTask({
      projectId: "shop",
      projectMoves: [
        { from: "docs", to: "admin-panel", at: new Date("2026-11-01T10:00:00.000Z"), by: THE_USER },
        { from: "admin-panel", to: "shop", at: new Date("2026-11-02T10:00:00.000Z"), by: THE_USER },
      ],
    });

    const lines = taskRecordText(task, NOTHING).split("\n");

    expect(lines.filter((line) => line.startsWith("- Moved"))).toEqual([
      "- Moved from Project docs to Project admin-panel by the user on 2026-11-01T10:00:00.000Z",
      "- Moved from Project admin-panel to Project shop by the user on 2026-11-02T10:00:00.000Z",
    ]);
  });

  it("names no Move for a Task that never moved", () => {
    expect(taskRecordText(aTask(), NOTHING)).not.toContain("Moved from");
  });

  it("lists its linked records, one line each with title, id, state and the tool that reads it", () => {
    const links: TaskLinks = {
      waitsFor: [
        aTask({ id: "task-2", title: "Add the session store", state: "done" }),
        aTask({ id: "task-3", title: "Old approach", state: "dropped", archivedAt: ARCHIVED_AT }),
      ],
      waitingForIt: [aTask({ id: "task-4", title: "Remember me", state: "backlog" })],
      idea: anIdea({ state: "shaped", taskId: "task-1" }),
      initiative: anInitiative({ state: "dropped" }),
    };

    expect(part(taskRecordText(aTask(), { ...NOTHING, links }), "Linked records:")).toEqual([
      "Linked records:",
      "- Waits for: Add the session store (Task task-2), Done; read_task reads it",
      "- Waits for: Old approach (Task task-3), Dropped, so it no longer blocks, archived; read_task reads it",
      "- Waiting for it: Remember me (Task task-4), Backlog; read_task reads it",
      "- Shaped from: Export usage as CSV (Idea idea-1), shaped; read_idea reads it",
      "- Part of: Usage exports (Initiative initiative-1), dropped; read_initiative reads it",
    ]);
  });

  it("says when it is linked to no record and no Stage has run", () => {
    const record = taskRecordText(aTask(), NOTHING);

    expect(part(record, "Linked records:")).toEqual(["Linked records:", "None."]);
    expect(part(record, "Stage results:")).toEqual(["Stage results:", "None."]);
    expect(record).not.toContain("Handover notes:");
  });

  it("gives its Stage results in the order they ran, and every Handover note with its Stage and Role", () => {
    const record = taskRecordText(aTask(), {
      ...NOTHING,
      stageResults: {
        lines: [
          "- Implement (Agent Stage): done. Fixed it.",
          "- Review (Agent Stage): done. Looks right.",
        ],
        handoverNotes: [
          { stageName: "Implement", roleKey: "developer", note: "Left: the logout page." },
          { stageName: "Review", roleKey: "reviewer", note: "Left: nothing." },
        ],
      },
    });

    expect(part(record, "Stage results:")).toEqual([
      "Stage results:",
      "- Implement (Agent Stage): done. Fixed it.",
      "- Review (Agent Stage): done. Looks right.",
    ]);
    expect(part(record, "Handover notes:")).toEqual([
      "Handover notes:",
      "- Implement, by the Role developer: Left: the logout page.",
      "- Review, by the Role reviewer: Left: nothing.",
    ]);
  });
});

describe("ideaRecordText", () => {
  it("names the Task it was shaped into by title and state, archived ones marked", () => {
    const task = aTask({ state: "done", archivedAt: ARCHIVED_AT });
    const record = ideaRecordText(
      anIdea({ state: "shaped", taskId: task.id }),
      { kind: "task", task },
      [],
    );

    expect(record).toContain(
      "- Shaped into: Fix the login redirect (Task task-1), Done, archived; read_task reads it",
    );
  });

  it("names the Initiative it was shaped into by name and state", () => {
    const initiative = anInitiative({ state: "active" });
    const idea = anIdea({ state: "shaped", initiativeId: initiative.id });

    expect(ideaRecordText(idea, { kind: "initiative", initiative }, [])).toContain(
      "- Shaped into: Usage exports (Initiative initiative-1), active; read_initiative reads it",
    );
  });

  it("names nothing it was shaped into while it is new", () => {
    expect(ideaRecordText(anIdea(), undefined, [])).not.toContain("Shaped into");
  });
});

describe("initiativeRecordText", () => {
  it("names the Idea it was shaped from by title and state", () => {
    const idea = anIdea({ state: "shaped", initiativeId: "initiative-1" });

    expect(initiativeRecordText(anInitiative(), idea, [], new Map(), [])).toContain(
      "- Shaped from: Export usage as CSV (Idea idea-1), shaped; read_idea reads it",
    );
  });

  it("says when it ended and that it is archived, its state as it was", () => {
    const idea = anIdea({ state: "shaped", initiativeId: "initiative-1" });
    const initiative = anInitiative({
      state: "dropped",
      endedAt: new Date("2026-10-30T09:00:00.000Z"),
      archivedAt: new Date("2026-11-29T09:00:00.000Z"),
    });

    const text = initiativeRecordText(initiative, idea, [], new Map(), []);

    expect(text).toContain("- Dropped on 2026-10-30T09:00:00.000Z");
    expect(text).toContain(
      "- Archived on 2026-11-29T09:00:00.000Z: off the board, its state as it was",
    );
  });
});
