import { describe, expect, it } from "vitest";
import {
  agentStageRecord,
  agentStageWork,
  earlierResults,
  stageResultWords,
  type BriefTask,
} from "./agent-stage-brief.js";
import { allowedCommands } from "./allowed-commands.js";
import { hardSwitchesSection, type FollowedHardSwitches } from "./followed-hard-switches.js";
import { GATE_REACHED } from "./gate.js";
import type { AgentStage, Stage } from "./stage.js";
import { asFlow } from "./flow.js";
import { goingBackOnFailure, keptPublishStage, publishStage } from "./stage.fixtures.js";
import { aStageRun } from "./stage-run.fixtures.js";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { PIPELINES_PROMPT_TEMPLATES } from "./pipelines-prompt-templates.js";

const prompts = defaultPromptTexts(PIPELINES_PROMPT_TEMPLATES);

const GIT = ["status", "diff"];
const COMMANDS = [
  { key: "build", name: "Build", commandLine: "npm run build" },
  { key: "lint", name: "Lint", commandLine: "" },
  { key: "test", name: "Test", commandLine: "npm test" },
  { key: "test-full", name: "Full tests", commandLine: "npm run test:full" },
];

const HARD_SWITCHES: FollowedHardSwitches = {
  runInstalls: { kind: "consult", person: "Devops" },
  publishOutsideThePipeline: { kind: "never" },
};

const task: BriefTask = {
  title: "Rename a device",
  descriptionSection: "## What the user wants, in their own words\n\nLet me name my devices.",
  plan: "",
  definitionOfDone: [],
  commitMessage: { text: "Rename a device", written: false },
  attachmentLines: [],
  linkedRecordsSection: undefined,
  connectedDeviceLines: [],
  whoAskedSection:
    "## Who asked\n\nThe Task was created by the user Ann Lee and started by the user Ben Ito.",
  projectName: "Admin panel",
  baseBranch: "main",
  worktree: {
    path: "/worktrees/task",
    branch: "office/task",
    screenshotsFolder: ".office/screenshots",
  },
};

describe("allowedCommands", () => {
  it("names exactly what the engine allows", () => {
    expect(allowedCommands(prompts, "read-only-git", COMMANDS, undefined, GIT)).toEqual({
      permission: { kind: "read-only-git" },
      words: "You may run read-only git (git status, git diff) only.",
    });
    expect(allowedCommands(prompts, "project-commands", COMMANDS, undefined, GIT)).toEqual({
      permission: {
        kind: "project-commands",
        commandLines: ["npm run build", "npm test", "npm run test:full"],
      },
      words:
        "You may run the Project's commands, exactly as written, and read-only git (git status, git diff):\n\n- build (Build): `npm run build`\n- test (Test): `npm test`\n- test-full (Full tests): `npm run test:full`",
    });
    expect(allowedCommands(prompts, "project-commands", [], undefined, GIT).words).toBe(
      "The Project has no commands to run, so you may run read-only git (git status, git diff) only.",
    );
    expect(allowedCommands(prompts, "anything", COMMANDS, undefined, GIT).permission).toEqual({
      kind: "anything",
    });
  });
});

describe("agentStageRecord", () => {
  it("leaves out what the Task doesn't have yet", () => {
    const record = agentStageRecord(prompts, {
      task,
      earlier: [],
      diffSummary: undefined,
      commands: allowedCommands(prompts, "read-only-git", [], undefined, GIT),
      hardSwitches: HARD_SWITCHES,
    });

    expect(record).toBe(
      [
        "## The Task\n\nRename a device, in the Project Admin panel.",
        task.whoAskedSection,
        "## What the user wants, in their own words\n\nLet me name my devices.",
        "## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, which started from main.\n\nScreenshots go in .office/screenshots/ there: git ignores it, and The Office keeps it as you leave it across test runs.",
        "## The commit message\n\nNone is written yet, so Publish lands the Task as one commit with the default, its title with a short summary below it:\n\n```\nRename a device\n```\n\nUpdate it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.",
        "## Attachments\n\nNone.",
        "## Commands you may run\n\nYou may run read-only git (git status, git diff) only.",
        "Run them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.",
        "The Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.",
        hardSwitchesSection(prompts, HARD_SWITCHES),
      ].join("\n\n"),
    );
  });

  it("says a Task of an Initiative with a Pipeline starts from and publishes into its branch", () => {
    const record = agentStageRecord(prompts, {
      task: { ...task, initiativeBranch: "initiative/usage-exports" },
      earlier: [],
      diffSummary: undefined,
      commands: allowedCommands(prompts, "read-only-git", [], undefined, GIT),
      hardSwitches: HARD_SWITCHES,
    });

    expect(record).toContain(
      "on the branch office/task, which started from the Initiative's branch initiative/usage-exports, and its Publish lands it on initiative/usage-exports as one commit, not on main. The Office brings initiative/usage-exports, then main into it.\n\n",
    );
  });

  it("lists the Task's linked records, as Work words them, before its Attachments", () => {
    const linkedRecordsSection =
      "## Linked records\n\n- Waits for: Add the session store (Task t-2), Done; read_task reads it\n\nRead them with read_task, read_idea and read_initiative, and their Attachments with read_attachment: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase, an image as a picture where the engine shows one, and any other file by its name, kind and size.";

    const record = agentStageRecord(prompts, {
      task: { ...task, linkedRecordsSection },
      earlier: [],
      diffSummary: undefined,
      commands: allowedCommands(prompts, "read-only-git", [], undefined, GIT),
      hardSwitches: HARD_SWITCHES,
    });

    expect(record).toContain(`${linkedRecordsSection}\n\n## Attachments\n\nNone.`);
  });

  it("names each earlier Stage's result, with its Handover note, and the diff so far", () => {
    const record = agentStageRecord(prompts, {
      task,
      earlier: [
        {
          stageName: "Implement",
          kind: "agent",
          outcome: { status: "done", summary: "Added it.", handoverNote: "Check the list." },
        },
        { stageName: "Tests", kind: "script", outcome: { status: "failed", error: "1 fails." } },
      ],
      diffSummary: "2 files changed",
      commands: allowedCommands(prompts, "anything", [], undefined, GIT),
      hardSwitches: HARD_SWITCHES,
    });

    expect(record).toContain(
      "## Earlier Stages\n\n- Implement (Agent Stage): done. Added it.\n  Handover note: Check the list.\n- Tests (Script Stage): failed. 1 fails.",
    );
    expect(record).toContain("## What changed so far\n\n2 files changed");
  });
});

describe("earlierResults", () => {
  const implement: Stage = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    optional: false,
    role: "developer",
    brief: "Build it.",
    session: "fresh",
    budget: 100_000,
  };
  const look: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
  const done = { status: "done", summary: "Added it." } as const;
  const followed = (guidance?: string) =>
    aStageRun({
      stageKey: "implement",
      outcome: done,
      decisions: [
        {
          id: "decision-1",
          kind: "no-route-holds",
          options: [],
          answer: { kind: "follow-route", to: "look", ...(guidance && { guidance }) },
        },
      ],
    });

  it("names a Gate's run only for the notes the user continued with, in run order", () => {
    const runs = [
      aStageRun({ stageKey: "implement", outcome: done }),
      aStageRun({ stageKey: "look", outcome: GATE_REACHED, gateAction: { kind: "continue" } }),
      aStageRun({
        stageKey: "look",
        outcome: GATE_REACHED,
        gateAction: { kind: "continue", feedback: "Build version B.\nKeep the colours." },
      }),
    ];

    expect(
      earlierResults([implement, look], runs).map((result) => stageResultWords(prompts, result)),
    ).toEqual([
      "- Implement (Agent Stage): done. Added it.",
      "- Look (Gate): the user let the work continue, with notes for the Stages after it. Follow them:\n  Build version B.\n  Keep the colours.",
    ]);
  });

  it("carries the notes the user chose a route with when none of the Stage's routes held", () => {
    expect(
      earlierResults([implement, look], [followed("Skip the review.\nShip it.")]).map((result) =>
        stageResultWords(prompts, result),
      ),
    ).toEqual([
      "- Implement (Agent Stage): done. Added it.\n  None of its routes held, so the user chose where the work goes on, with notes for the Stages after it. Follow them:\n  Skip the review.\n  Ship it.",
    ]);
    expect(
      earlierResults([implement, look], [followed()]).map((result) =>
        stageResultWords(prompts, result),
      ),
    ).toEqual(["- Implement (Agent Stage): done. Added it."]);
  });
});

describe("agentStageWork", () => {
  it("carries the failure a loop went back with", () => {
    expect(
      agentStageWork(
        prompts,
        { key: "implement", name: "Implement", brief: "Build it." },
        {
          carried: {
            stageKey: "tests",
            stageName: "Tests",
            error: "1 fails.",
            round: 1,
            rounds: 2,
          },
        },
      ),
    ).toBe(
      '## The Stage: Implement\n\nBuild it.\n\n## Why this Stage runs again\n\n"Tests" failed after it, so the Pipeline went back here (round 1 of at most 2):\n\n1 fails.',
    );
  });

  it("carries the round the user gave the Stage itself, with their guidance", () => {
    const work = agentStageWork(
      prompts,
      { key: "implement", name: "Implement", brief: "Build it." },
      {
        carried: {
          stageKey: "implement",
          stageName: "Implement",
          error: "The session ended.",
          round: 1,
          rounds: 1,
          guidance: "Keep the old dialog.",
        },
      },
    );

    expect(work).toContain(
      "## Why this Stage runs again\n\nThe user chose one more round of this Stage after:\n\nThe session ended.\n\nThe user's guidance for this round:\n\nKeep the old dialog.",
    );
  });

  it("gives the feedback the user sent the work back with from a Gate, as no failure", () => {
    const work = agentStageWork(
      prompts,
      { key: "implement", name: "Implement", brief: "Build it." },
      { sentBack: { gateKey: "look", gateName: "UI acceptance", feedback: "Name it Save." } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Sent back from UI acceptance\n\nThe user looked at the work so far at the Gate and sent it back to this Stage with their feedback. It is no failure: act on it, then end the Stage with its result.\n\nName it Save.",
    );
  });

  it("gives the user's answer to the question the Stage's Agent asked", () => {
    const work = agentStageWork(
      prompts,
      { key: "implement", name: "Implement", brief: "Build it." },
      { answered: { question: "Which page?", answer: "The list" } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Your question, answered\n\nYou asked the user: Which page?\n\nTheir answer: The list\n\nGo on with the Stage from there.",
    );
  });

  it("tells a Stage the user paused and resumed to go on with its edits", () => {
    const work = agentStageWork(
      prompts,
      { key: "implement", name: "Implement", brief: "Build it." },
      { held: { by: "pause" } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Paused by the user\n\nThe user paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.",
    );
  });

  it("tells a Stage the user stopped and resumed that its uncommitted edits are gone", () => {
    const work = agentStageWork(
      prompts,
      { key: "implement", name: "Implement", brief: "Build it." },
      { held: { by: "stop" } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Stopped by the user\n\nThe user stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.",
    );
  });

  it("tells a Stage going on after a restart that its last turn was cut short and its edits kept, to check them first, with the user's words", () => {
    const work = agentStageWork(
      prompts,
      { key: "implement", name: "Implement", brief: "Build it." },
      { held: { by: "restart", guidance: "Skip the dialog's tests." } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## The Office restarted\n\nThe Office restarted while this Stage ran, which cut your last turn short, and the Stage goes on now. The Stage's uncommitted edits are still in the worktree, but the cut may have left one half-done, such as a file half-written: check `git status` and `git diff` first, then go on with the Stage's work from there, and end with its result.\n\nThe user's words for it:\n\nSkip the dialog's tests.",
    );
  });
});

describe("agentStageWork's Later Stages", () => {
  const implement: AgentStage = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    optional: false,
    role: "developer",
    brief: "Build it.",
    session: "fresh",
    budget: 100_000,
  };
  const lint: Stage = {
    kind: "script",
    key: "lint-after",
    name: "Lint after review",
    optional: false,
    command: "build",
  };
  const review: AgentStage = {
    ...implement,
    key: "review",
    name: "Review & fix",
    role: "reviewer",
    brief: "Review the diff.\nFix what you find.",
  };
  const look: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };
  const titles: Readonly<Record<string, string>> = { developer: "Developer", reviewer: "Reviewer" };

  function workIn(stage: AgentStage, stages: readonly Stage[]): string {
    return agentStageWork(prompts, stage, {
      pipeline: { stages, commands: COMMANDS, roleTitle: (roleKey) => titles[roleKey] ?? roleKey },
    });
  }

  it("lists every Stage after this one in order: a command, a Role and its brief, a Gate", () => {
    expect(workIn(implement, [implement, review, lint, look])).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n- Review & fix (Agent Stage, Reviewer): Review the diff.\n  Fix what you find.\n- Lint after review (Script Stage): runs `npm run build`.\n- UI acceptance (Gate): the user looks at the work there and lets it continue or sends it back.\n\nWhile you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.",
    );
  });

  it("tells the Agent to run only the tests it needs while a later Script Stage runs a Project command, never for Publish alone", () => {
    const line =
      "While you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.";

    expect(workIn(implement, [implement, lint])).toContain(line);
    expect(workIn(implement, [implement, review, publishStage()])).not.toContain(line);
    expect(workIn(implement, [implement, { ...lint, command: "lint" }])).not.toContain(line);
    expect(workIn(review, [lint, implement, review])).not.toContain(line);
  });

  it("leaves out the Stages before this one", () => {
    const work = workIn(review, [implement, review, look]);

    expect(work).not.toContain("- Implement");
    expect(work).toContain("in order:\n\n- UI acceptance (Gate)");
  });

  it("marks a Stage whose failure comes back here, and no longer an optional one", () => {
    const work = workIn(implement, [
      implement,
      goingBackOnFailure(lint, "implement", 2),
      goingBackOnFailure({ ...review, optional: true }, "lint-after", 1),
    ]);

    expect(work).toContain(
      "- Lint after review (Script Stage): runs `npm run build`. If it fails, the work comes back here.\n- Review & fix (Agent Stage, Reviewer): Review the diff.\n  Fix what you find.",
    );
    expect(work).not.toContain("find. If it fails");
  });

  it("says what a Publish does, and names a command the Project hasn't set", () => {
    const work = workIn(implement, [
      implement,
      { ...lint, name: "Lint", command: "lint" },
      publishStage(),
    ]);

    expect(work).toContain(
      "- Lint (Script Stage): runs the Project's command lint, which isn't set.",
    );
    expect(work).toContain("- Publish (Publish Stage): The Office publishes the Task's work.");
  });

  it("says a Stage of the conflict chain runs only after a conflict at Publish", () => {
    const work = workIn(implement, asFlow([implement, lint, keptPublishStage()]));

    expect(work).toContain(
      "- Resolve (Agent Stage, Developer): Resolve the conflicts the merge of the base left in the Task's branch.",
    );
    expect(work).toContain(
      "If you can't resolve a conflict, end the Stage failed and say why. It runs only after a conflict at Publish.",
    );
    expect(work).toContain(
      "- Test after Resolve (Script Stage): runs `npm test`. It runs only after a conflict at Publish.",
    );
    expect(work).toContain("- Lint after review (Script Stage): runs `npm run build`.\n");
  });

  it("tells the last Stage that no Stage comes after it", () => {
    expect(workIn(implement, [look, implement])).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Later Stages\n\nNo Stage comes after this one in the Task's Pipeline.",
    );
  });
});
