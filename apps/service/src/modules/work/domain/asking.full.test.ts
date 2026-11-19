import { describe, expect, it } from "vitest";
import { askingBrief, type AskingRecord } from "./asking.js";
import { aTask } from "./work.fixtures.js";
import { defaultWorkPrompts } from "./work-prompt-templates.fixtures.js";

const prompts = defaultWorkPrompts();

function aRecord(fields: Partial<AskingRecord> = {}): AskingRecord {
  return {
    task: aTask({
      title: "Fix the login redirect",
      description: "Users land on a blank page.",
      plan: "Read the cookie first.",
      definitionOfDone: ["The redirect lands on the dashboard."],
    }),
    projectName: "Admin panel",
    worktree: { path: "/worktrees/admin", branch: "office/task" },
    attachments: [],
    stageResults: [],
    diffSummary: undefined,
    handoverNotes: [],
    ...fields,
  };
}

describe("the first Brief of a person's Thread on a Task", () => {
  it("holds the Task's title, Description, Plan and Definition of Done", () => {
    const brief = askingBrief(prompts, aRecord());

    expect(brief).toContain("Fix the login redirect");
    expect(brief).toContain("Users land on a blank page.");
    expect(brief).toContain("Read the cookie first.");
    expect(brief).toContain("- The redirect lands on the dashboard.");
    expect(brief).not.toContain("## Stage results");
    expect(brief).not.toContain("## What changed so far");
    expect(brief).not.toContain("## Your Handover notes");
  });

  it("holds the Stage results, the diff and the person's own Handover notes", () => {
    const brief = askingBrief(
      prompts,
      aRecord({
        stageResults: ["- Implement (Agent): done. Fixed it."],
        diffSummary: "2 files changed",
        handoverNotes: ["Left: the logout page.", "Left: nothing."],
      }),
    );

    expect(brief).toContain("## Stage results\n\n- Implement (Agent): done. Fixed it.");
    expect(brief).toContain("## What changed so far\n\n2 files changed");
    expect(brief).toContain(
      "## Your Handover notes on this Task\n\nLeft: the logout page.\n\nLeft: nothing.",
    );
  });
});
