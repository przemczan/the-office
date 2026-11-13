import { describe, expect, it } from "vitest";
import { initiativeSection, LONG_PLAN_CHARACTERS } from "./initiative-section.js";
import type { InitiativeRecord } from "./record-words.js";
import type { Task } from "./task.js";
import { aLink, anIdea, anInitiative, aTask } from "./work.fixtures.js";

const PLANNED = aTask({ id: "task-1", title: "Export button", initiativeId: "initiative-1" });

function anInitiativeRecord(
  tasks: readonly Task[],
  fields: Partial<InitiativeRecord> = {},
): InitiativeRecord {
  return {
    initiative: anInitiative({ state: "active" }),
    idea: anIdea({ state: "shaped", initiativeId: "initiative-1" }),
    tasks,
    blockers: new Map(tasks.map((task) => [task.id, task])),
    attachments: [],
    pipelineNames: new Map(),
    ...fields,
  };
}

describe("a planning Brief's Initiative section", () => {
  it("names the Initiative, its state and its outcome", () => {
    const record = anInitiativeRecord([PLANNED], {
      initiative: anInitiative({ state: "active", outcome: "The accountant gets a CSV monthly." }),
    });

    expect(initiativeSection(record, PLANNED.id)).toContain(
      [
        "## The Initiative",
        "This Task is part of Usage exports (Initiative initiative-1), active.",
        "Outcome:\nThe accountant gets a CSV monthly.",
      ].join("\n\n"),
    );
  });

  it("says when the outcome isn't written yet and the Initiative has no other Task", () => {
    const section = initiativeSection(anInitiativeRecord([PLANNED]), PLANNED.id);

    expect(section).toContain("Outcome:\nNot written yet.\n\nIt has no other Tasks.");
  });

  it("lists the other Tasks in the order they were added, with what they must wait for, leaving out this one", () => {
    const schema = aTask({
      id: "task-2",
      title: "Billing schema",
      state: "done",
      projectId: "api",
    });
    const endpoint = aTask({
      id: "task-3",
      title: "Export endpoint",
      state: "planning",
      projectId: "api",
      blockedBy: ["task-2"],
    });
    const record = anInitiativeRecord([schema, PLANNED, endpoint]);

    const section = initiativeSection(record, PLANNED.id);

    expect(section).toContain(
      [
        "Its other Tasks, in the order they were added:",
        "### Billing schema (Task task-2), in the Project api, Done\n\nNo Plan yet.",
        "### Export endpoint (Task task-3), in the Project api, Planning; must wait for Billing schema (Task task-2, Done)\n\nNo Plan yet.",
      ].join("\n\n"),
    );
    expect(section).not.toContain("Task task-1");
  });

  it("gives each other Task's Plan, marked confirmed or not, with its files to change", () => {
    const confirmed = aTask({
      id: "task-2",
      title: "Export endpoint",
      plan: "Add GET /usage.csv.",
      planConfirmed: true,
      filesToChange: ["apps/api/usage.ts"],
    });
    const proposed = aTask({ id: "task-3", title: "Export docs", plan: "Document the CSV." });

    const section = initiativeSection(
      anInitiativeRecord([confirmed, PLANNED, proposed]),
      PLANNED.id,
    );

    expect(section).toContain(
      "Plan, confirmed:\n\nAdd GET /usage.csv.\n\nFiles to change:\n- apps/api/usage.ts",
    );
    expect(section).toContain("Plan, not yet confirmed:\n\nDocument the CSV.");
  });

  it("leaves a long Plan to read_task", () => {
    const longPlan = "x".repeat(LONG_PLAN_CHARACTERS + 1);
    const endpoint = aTask({ id: "task-2", title: "Export endpoint", plan: longPlan });
    const atTheLimit = aTask({
      id: "task-3",
      title: "Export docs",
      plan: "y".repeat(LONG_PLAN_CHARACTERS),
    });

    const section = initiativeSection(
      anInitiativeRecord([endpoint, atTheLimit, PLANNED]),
      PLANNED.id,
    );

    expect(section).toContain("Its Plan, not yet confirmed, is long: read_task reads it.");
    expect(section).not.toContain(longPlan);
    expect(section).toContain("y".repeat(LONG_PLAN_CHARACTERS));
  });

  it("lists the Initiative's Attachments by id, with how to read them", () => {
    const record = anInitiativeRecord([PLANNED], {
      attachments: [aLink({ owner: { kind: "initiative", initiativeId: "initiative-1" } })],
    });

    expect(initiativeSection(record, PLANNED.id)).toMatch(
      /Attachments: Read one with read_attachment, by its id: .*\n\n- CSV format notes \(link to https:\/\/example\.com\/csv\) · Attachment attachment-1$/,
    );
  });

  it("says when the Initiative has no Attachment", () => {
    expect(initiativeSection(anInitiativeRecord([PLANNED]), PLANNED.id)).toMatch(
      /Attachments:\nNone\.$/,
    );
  });
});
