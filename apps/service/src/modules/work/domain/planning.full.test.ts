import { describe, expect, it } from "vitest";
import { planningBrief, type PlanningPipeline, type PlanningRecord } from "./planning.js";
import type { TaskLinks } from "./linked-records.js";
import { aLink, anIdea, anInitiative, aPlannedTask, aTask } from "./work.fixtures.js";
import { defaultWorkPrompts } from "./work-prompt-templates.fixtures.js";

const prompts = defaultWorkPrompts();

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

const NO_LINKS: TaskLinks = {
  waitsFor: [],
  waitingForIt: [],
  idea: undefined,
  initiative: undefined,
};

const RECORD: PlanningRecord = {
  task: aTask({ originIdeaId: "idea-1" }),
  stateChanges: [],
  project: {
    name: "Admin panel",
    baseBranch: "main",
    defaultPipeline: "full",
    installCommand: "npm install",
    commands: [
      { key: "build", name: "Build", commandLine: "npm run build" },
      { key: "lint", name: "Lint", commandLine: "" },
      { key: "test", name: "Test", commandLine: "npm test" },
    ],
  },
  worktree: { path: "/office/worktrees/admin-panel/task-1", branch: "office/task-1" },
  links: {
    waitsFor: [],
    waitingForIt: [],
    idea: anIdea({ taskId: "task-1", state: "shaped" }),
    initiative: undefined,
  },
  attachments: [aLink({ owner: { kind: "task", taskId: "task-1" } })],
  pipelines: PIPELINES,
};

describe("a planning Brief", () => {
  it("carries the Task, where it is worked, where it came from, its linked records, its Attachments, the commands and the Pipelines", () => {
    expect(planningBrief(prompts, RECORD)).toBe(
      [
        "You are planning a Task with the user, in the Task's planning Thread.",
        "## The Task\n\nFix the login redirect (Task task-1), in the Project Admin panel.",
        "Kind: Feature. Its commit type is feat (Bug → fix, Feature → feat, Chore → chore).\nIf the Task isn't what its Kind says, change it with write_kind; set Caused by and Found in version with write_bug_details.",
        "## Who asked\n\nThe Task was created by the user Ann Lee.",
        "## What the user wants, in their own words\n\nNone: the title is all there is.",
        "## Where you work\n\nThe Task's worktree, at /office/worktrees/admin-panel/task-1 on the branch office/task-1, which started from the freshly fetched main.",
        '## Where it came from\n\nThe Idea "Export usage as CSV". Its notes:\n\nMonthly, per Project, for the accountant.',
        "## Linked records\n\n- Shaped from: Export usage as CSV (Idea idea-1), in the Project admin-panel, shaped; read_idea reads it\n\nRead them with read_task, read_idea and read_initiative, and their Attachments with read_attachment: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase, an image as a picture where the engine shows one, and any other file by its name, kind and size.",
        "## Attachments\n\nRead one with read_attachment, by its id: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase; an image as a picture where the engine shows one; any other file by its name, kind and size.\n\n- CSV format notes (link to https://example.com/csv) · Attachment attachment-1",
        "## The Project's commands\n\n- install (Install): `npm install`\n- build (Build): `npm run build`\n- lint (Lint): none\n- test (Test): `npm test`",
        "## The Pipelines\n\nThe Task follows Full (full) until the user confirms another. The Pipeline Admin panel gives Features is Full (full); propose it with propose_pipeline unless the work needs another:",
        "- full: Full (Implement → Tests → Publish). For a change to the code.\n- document: Document (Produce → Review & fix). For a document as the result.",
        "## Auto mode\n\nOff: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.",
      ].join("\n\n"),
    );
  });

  it("carries the user's Description", () => {
    const task = aTask({ description: "After signing in, land on the page I came from." });

    expect(planningBrief(prompts, { ...RECORD, task })).toContain(
      "## What the user wants, in their own words\n\nAfter signing in, land on the page I came from.",
    );
  });

  it("quotes the Idea's notes only once the Description differs from them", () => {
    const notes = "Monthly, per Project, for the accountant.";
    const shaped = planningBrief(prompts, { ...RECORD, task: aTask({ description: notes }) });
    const edited = planningBrief(prompts, {
      ...RECORD,
      task: aTask({ description: "Yearly too." }),
    });

    expect(shaped).toContain(
      '## Where it came from\n\nThe Idea "Export usage as CSV", whose notes are the Description.',
    );
    expect(shaped.split(notes)).toHaveLength(2);
    expect(edited).toContain(`The Idea "Export usage as CSV". Its notes:\n\n${notes}`);
  });

  it("says when the Task came from no Idea and has no Attachment", () => {
    const brief = planningBrief(prompts, { ...RECORD, links: NO_LINKS, attachments: [] });

    expect(brief).toContain(
      "## Where it came from\n\nThe Task was created as it is, from no Idea.",
    );
    expect(brief).toContain("## Attachments\n\nNone.");
  });

  it("leaves out the linked records when the Task has none", () => {
    expect(planningBrief(prompts, { ...RECORD, links: NO_LINKS })).not.toContain(
      "## Linked records",
    );
  });

  it("has no Initiative section for a Task outside an Initiative", () => {
    expect(planningBrief(prompts, RECORD)).not.toContain("## The Initiative");
  });

  it("gives the Initiative the Task is part of after its linked records", () => {
    const task = aTask({ originIdeaId: "idea-1", initiativeId: "initiative-1" });
    const initiative = anInitiative({ state: "active" });
    const brief = planningBrief(prompts, {
      ...RECORD,
      task,
      links: { ...RECORD.links, initiative },
      initiative: {
        initiative,
        idea: anIdea({ state: "shaped" }),
        tasks: [task],
        blockers: new Map([[task.id, task]]),
        attachments: [],
        pipelineNames: new Map(),
      },
    });

    const sections = brief.split("\n\n## ").map((section) => section.split("\n")[0]);
    expect(
      sections.slice(sections.indexOf("Linked records"), sections.indexOf("Attachments")),
    ).toEqual(["Linked records", "The Initiative"]);
    expect(brief).toContain(
      "## The Initiative\n\nThis Task is part of Usage exports (Initiative initiative-1), active.",
    );
  });

  it("says a Task of an Initiative with a Pipeline starts from and publishes into its branch, naming the Pipeline", () => {
    const brief = planningBrief(prompts, {
      ...RECORD,
      startsFrom: { branch: "initiative/usage-exports", initiativePipeline: "Full (full)" },
    });

    expect(brief).toContain(
      "on the branch office/task-1, which started from the freshly fetched initiative/usage-exports.",
    );
    expect(brief).toContain(
      "## The Initiative's branch\n\nThe Initiative has the Pipeline Full (full) in this Project, so this Task starts from its branch initiative/usage-exports and publishes into it by merge, never into main directly. The Initiative's Pipeline runs only in the Project's Publishing Task, which takes initiative/usage-exports into main once its Tasks are done; this Task keeps a Pipeline of its own, the one you propose below.",
    );
  });

  it("says nothing of an Initiative's branch for a Task of the base branch", () => {
    const brief = planningBrief(prompts, RECORD);

    expect(brief).toContain("which started from the freshly fetched main.");
    expect(brief).not.toContain("## The Initiative's branch");
  });

  it("lists every linked record, one line each, with how to read them", () => {
    const links: TaskLinks = {
      waitsFor: [
        aTask({ id: "task-2", title: "Add the session store", state: "in-progress" }),
        aTask({ id: "task-3", title: "Old approach", state: "dropped" }),
      ],
      waitingForIt: [
        aTask({
          id: "task-4",
          title: "Remember me",
          state: "done",
          archivedAt: new Date("2026-11-01T10:00:00.000Z"),
        }),
      ],
      idea: anIdea({ state: "shaped" }),
      initiative: anInitiative({ state: "active" }),
    };

    expect(planningBrief(prompts, { ...RECORD, links })).toContain(
      [
        "## Linked records",
        "",
        "- Waits for: Add the session store (Task task-2), In progress; read_task reads it",
        "- Waits for: Old approach (Task task-3), Dropped, so it no longer blocks; read_task reads it",
        "- Waiting for it: Remember me (Task task-4), Done, archived; read_task reads it",
        "- Shaped from: Export usage as CSV (Idea idea-1), in the Project admin-panel, shaped; read_idea reads it",
        "- Part of: Usage exports (Initiative initiative-1), active; read_initiative reads it",
        "",
        "Read them with read_task, read_idea and read_initiative, and their Attachments with read_attachment: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase, an image as a picture where the engine shows one, and any other file by its name, kind and size.",
      ].join("\n"),
    );
  });

  it("carries the Plan and the Definition of Done once written, each confirmed or proposed", () => {
    const brief = planningBrief(prompts, {
      ...RECORD,
      task: aPlannedTask({ planConfirmed: false }),
    });

    expect(brief).toMatch(
      /## The Plan, not yet confirmed\n\nKeep the requested path through the sign-in\.\n\n## The Definition of Done, confirmed\n\n- Signing in returns the user to the page they asked for\.$/,
    );
  });

  it("says the Task has no Pipeline yet and names the one the Project gives its Kind", () => {
    const task = aTask({ pipelineId: undefined });

    expect(planningBrief(prompts, { ...RECORD, task })).toContain(
      "## The Pipelines\n\nThe Task has no Pipeline yet. The Pipeline Admin panel gives Features is Full (full); propose it with propose_pipeline unless the work needs another:",
    );
  });

  it("names a Bug's Kind, its commit type and its bug details", () => {
    const task = aTask({ kind: "bug", causedBy: "task-9", foundInVersion: "v1.14.2" });

    expect(planningBrief(prompts, { ...RECORD, task })).toContain(
      "Kind: Bug. Its commit type is fix (Bug → fix, Feature → feat, Chore → chore).\nCaused by: Task task-9. Found in version: v1.14.2.\nIf the Task isn't what its Kind says",
    );
  });

  it("lists the Project's own Pipelines first, its default first, each with its base Pipeline, then the office-wide ones", () => {
    const pipelines: readonly PlanningPipeline[] = [
      {
        id: "full-with-linux",
        name: "Full with Linux check",
        description: "For a change the Linux run can break.",
        stages: [{ name: "Implement" }, { name: "Verify on Linux" }],
        projectId: "admin-panel",
        basePipeline: { id: "full", name: "Full" },
        broken: [],
      },
      {
        id: "spec-change",
        name: "Spec change",
        description: "For a change to the spec.",
        stages: [{ name: "Write" }],
        projectId: "admin-panel",
        basePipeline: { id: "document", name: "Document" },
        broken: ["Changes Produce, which Document no longer has."],
      },
      ...PIPELINES,
    ];
    const task = aTask({ pipelineId: undefined });

    const brief = planningBrief(prompts, {
      ...RECORD,
      task,
      project: { ...RECORD.project, defaultPipeline: "spec-change" },
      pipelines,
    });

    expect(brief).toContain(
      [
        "## The Pipelines\n\nThe Task has no Pipeline yet. The Pipeline Admin panel gives Features is Spec change (spec-change), which is Broken: Changes Produce, which Document no longer has. It can't be proposed. Propose the one its Definition of Done needs with propose_pipeline:",
        "Admin panel's own Pipelines, which only its Tasks can follow:\n- spec-change: Spec change (Write). Built from Document. For a change to the spec. Broken: Changes Produce, which Document no longer has. It can't be proposed.\n- full-with-linux: Full with Linux check (Implement → Verify on Linux). Built from Full. For a change the Linux run can break.",
        "Office-wide Pipelines:\n- full: Full (Implement → Tests → Publish). For a change to the code.\n- document: Document (Produce → Review & fix). For a document as the result.",
      ].join("\n\n"),
    );
  });

  it("carries the Pipeline the Planner proposed, waiting for the user", () => {
    const task = aTask({ proposedPipeline: { pipelineId: "document", reason: "A report." } });

    expect(planningBrief(prompts, { ...RECORD, task })).toMatch(
      /For a document as the result\.\n\nYou proposed Document \(document\): A report\. It waits for the user to confirm it\.\n\n## Auto mode/,
    );
  });

  it("says what marking the Task planned does in auto mode", () => {
    const task = aTask({ state: "planning", autoMode: true });

    expect(planningBrief(prompts, { ...RECORD, task })).toContain(
      "## Auto mode\n\nOn: once you mark the Task planned with mark_planned and no Decision on it is open, The Office confirms the Plan, the Definition of Done and the proposed Pipeline and marks the Task Ready.",
    );
  });
});
