import { describe, expect, it } from "vitest";
import { planningBrief, type PlanningRecord } from "./planning.js";
import { aLink, anIdea, aPlannedTask, aTask } from "./work.fixtures.js";

const RECORD: PlanningRecord = {
  task: aTask({ originIdeaId: "idea-1" }),
  project: {
    name: "Admin panel",
    baseBranch: "main",
    commands: { install: "npm install", build: "npm run build", lint: "", test: "npm test" },
  },
  worktree: { path: "/office/worktrees/admin-panel/task-1", branch: "office/task-1" },
  idea: anIdea({ taskId: "task-1", state: "shaped" }),
  attachments: [aLink({ owner: { kind: "task", taskId: "task-1" } })],
};

describe("a planning Brief", () => {
  it("carries the Task, where it is worked, where it came from, its Attachments and the commands", () => {
    expect(planningBrief(RECORD)).toBe(
      [
        "You are planning a Task with the user, in the Task's planning Thread.",
        "## The Task\n\nFix the login redirect (Task task-1), in the Project Admin panel, on the Pipeline full for now.",
        "## Where you work\n\nThe Task's worktree, at /office/worktrees/admin-panel/task-1 on the branch office/task-1, which started from the freshly fetched main.",
        '## Where it came from\n\nThe Idea "Export usage as CSV". Its notes:\n\nMonthly, per Project, for the accountant.',
        "## Attachments\n\n- CSV format notes (link to https://example.com/csv)",
        "## The Project's commands\n\n- install: `npm install`\n- build: `npm run build`\n- lint: none\n- test: `npm test`",
      ].join("\n\n"),
    );
  });

  it("says when the Task came from no Idea and has no Attachment", () => {
    const brief = planningBrief({ ...RECORD, idea: undefined, attachments: [] });

    expect(brief).toContain(
      "## Where it came from\n\nThe Task was created as it is, from no Idea.",
    );
    expect(brief).toContain("## Attachments\n\nNone.");
  });

  it("carries the Plan and the Definition of Done once written", () => {
    const brief = planningBrief({ ...RECORD, task: aPlannedTask() });

    expect(brief).toMatch(
      /## The Plan\n\nKeep the requested path through the sign-in\.\n\n## The Definition of Done\n\n- Signing in returns the user to the page they asked for\.$/,
    );
  });
});
