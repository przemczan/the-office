import { describe, expect, it } from "vitest";
import { planningBrief, type PlanningPipeline, type PlanningRecord } from "./planning.js";
import { aLink, anIdea, aPlannedTask, aTask } from "./work.fixtures.js";

const PIPELINES: readonly PlanningPipeline[] = [
  {
    id: "full",
    name: "Full",
    description: "For a change to the code.",
    stages: [{ name: "Implement" }, { name: "Tests" }, { name: "Publish" }],
  },
  {
    id: "document",
    name: "Document",
    description: "For a document as the result.",
    stages: [{ name: "Produce" }, { name: "Review & fix" }],
  },
];

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
  pipelines: PIPELINES,
};

describe("a planning Brief", () => {
  it("carries the Task, where it is worked, where it came from, its Attachments, the commands and the Pipelines", () => {
    expect(planningBrief(RECORD)).toBe(
      [
        "You are planning a Task with the user, in the Task's planning Thread.",
        "## The Task\n\nFix the login redirect (Task task-1), in the Project Admin panel.",
        "## What the user wants, in their own words\n\nNone: the title is all there is.",
        "## Where you work\n\nThe Task's worktree, at /office/worktrees/admin-panel/task-1 on the branch office/task-1, which started from the freshly fetched main.",
        '## Where it came from\n\nThe Idea "Export usage as CSV". Its notes:\n\nMonthly, per Project, for the accountant.',
        "## Attachments\n\nRead one with read_attachment, by its id.\n\n- CSV format notes (link to https://example.com/csv) · Attachment attachment-1",
        "## The Project's commands\n\n- install: `npm install`\n- build: `npm run build`\n- lint: none\n- test: `npm test`",
        "## The Pipelines\n\nThe Task follows Full (full) until the user confirms another. Propose the one its Definition of Done needs with propose_pipeline:",
        "- full: Full (Implement → Tests → Publish). For a change to the code.\n- document: Document (Produce → Review & fix). For a document as the result.",
      ].join("\n\n"),
    );
  });

  it("carries the user's Description", () => {
    const task = aTask({ description: "After signing in, land on the page I came from." });

    expect(planningBrief({ ...RECORD, task })).toContain(
      "## The Task\n\nFix the login redirect (Task task-1), in the Project Admin panel.\n\n## What the user wants, in their own words\n\nAfter signing in, land on the page I came from.",
    );
  });

  it("quotes the Idea's notes only once the Description differs from them", () => {
    const notes = "Monthly, per Project, for the accountant.";
    const shaped = planningBrief({ ...RECORD, task: aTask({ description: notes }) });
    const edited = planningBrief({ ...RECORD, task: aTask({ description: "Yearly too." }) });

    expect(shaped).toContain(
      '## Where it came from\n\nThe Idea "Export usage as CSV", whose notes are the Description.',
    );
    expect(shaped.split(notes)).toHaveLength(2);
    expect(edited).toContain(`The Idea "Export usage as CSV". Its notes:\n\n${notes}`);
  });

  it("says when the Task came from no Idea and has no Attachment", () => {
    const brief = planningBrief({ ...RECORD, idea: undefined, attachments: [] });

    expect(brief).toContain(
      "## Where it came from\n\nThe Task was created as it is, from no Idea.",
    );
    expect(brief).toContain("## Attachments\n\nNone.");
  });

  it("carries the Plan and the Definition of Done once written, each confirmed or proposed", () => {
    const brief = planningBrief({ ...RECORD, task: aPlannedTask({ planConfirmed: false }) });

    expect(brief).toMatch(
      /## The Plan, not yet confirmed by the user\n\nKeep the requested path through the sign-in\.\n\n## The Definition of Done, confirmed by the user\n\n- Signing in returns the user to the page they asked for\.$/,
    );
  });

  it("carries the Pipeline the Planner proposed, waiting for the user", () => {
    const task = aTask({ proposedPipeline: { pipelineId: "document", reason: "A report." } });

    expect(planningBrief({ ...RECORD, task })).toMatch(
      /For a document as the result\.\n\nYou proposed Document \(document\): A report\. It waits for the user to confirm it\.$/,
    );
  });
});
