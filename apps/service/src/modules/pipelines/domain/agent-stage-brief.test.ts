import { describe, expect, it } from "vitest";
import { agentStageRecord, agentStageWork, type BriefTask } from "./agent-stage-brief.js";
import { allowedCommands } from "./allowed-commands.js";
import { hardSwitchesSection, type FollowedHardSwitches } from "./followed-hard-switches.js";

const GIT = ["status", "diff"];
const COMMANDS = { install: "npm ci", build: "npm run build", lint: "", test: "npm test" };

const HARD_SWITCHES: FollowedHardSwitches = {
  runInstalls: { kind: "consult", person: "Devops" },
  publishOutsideThePipeline: { kind: "never" },
};

const task: BriefTask = {
  title: "Rename a device",
  descriptionSection: "## What the user wants, in their own words\n\nLet me name my devices.",
  plan: "",
  definitionOfDone: [],
  attachmentLines: [],
  linkedRecordsSection: undefined,
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
    expect(allowedCommands("read-only-git", COMMANDS, GIT)).toEqual({
      permission: { kind: "read-only-git" },
      words: "You may run read-only git (git status, git diff) only.",
    });
    expect(allowedCommands("project-commands", COMMANDS, GIT)).toEqual({
      permission: { kind: "project-commands", commandLines: ["npm run build", "npm test"] },
      words:
        "You may run the Project's commands, exactly as written, and read-only git (git status, git diff):\n\n- build: `npm run build`\n- test: `npm test`",
    });
    expect(allowedCommands("project-commands", { install: "npm ci" }, GIT).words).toBe(
      "The Project has no commands to run, so you may run read-only git (git status, git diff) only.",
    );
    expect(allowedCommands("anything", COMMANDS, GIT).permission).toEqual({ kind: "anything" });
  });
});

describe("agentStageRecord", () => {
  it("leaves out what the Task doesn't have yet", () => {
    const record = agentStageRecord({
      task,
      earlier: [],
      diffSummary: undefined,
      commands: allowedCommands("read-only-git", {}, GIT),
      hardSwitches: HARD_SWITCHES,
    });

    expect(record).toBe(
      [
        "## The Task\n\nRename a device, in the Project Admin panel.",
        "## What the user wants, in their own words\n\nLet me name my devices.",
        "## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, which started from main.\n\nScreenshots go in .office/screenshots/ there: git ignores it, and The Office keeps it as you leave it across test runs.",
        "## Attachments\n\nNone.",
        "## Commands you may run\n\nYou may run read-only git (git status, git diff) only.",
        "Run them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.",
        "The Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.",
        hardSwitchesSection(HARD_SWITCHES),
      ].join("\n\n"),
    );
  });

  it("lists the Task's linked records, as Work words them, before its Attachments", () => {
    const linkedRecordsSection =
      "## Linked records\n\n- Waits for: Add the session store (Task t-2), Done; read_task reads it\n\nRead them with read_task, read_idea and read_initiative, and their Attachments with read_attachment.";

    const record = agentStageRecord({
      task: { ...task, linkedRecordsSection },
      earlier: [],
      diffSummary: undefined,
      commands: allowedCommands("read-only-git", {}, GIT),
      hardSwitches: HARD_SWITCHES,
    });

    expect(record).toContain(`${linkedRecordsSection}\n\n## Attachments\n\nNone.`);
  });

  it("names each earlier Stage's result, with its Handover note, and the diff so far", () => {
    const record = agentStageRecord({
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
      commands: allowedCommands("anything", {}, GIT),
      hardSwitches: HARD_SWITCHES,
    });

    expect(record).toContain(
      "## Earlier Stages\n\n- Implement (Agent Stage): done. Added it.\n  Handover note: Check the list.\n- Tests (Script Stage): failed. 1 fails.",
    );
    expect(record).toContain("## What changed so far\n\n2 files changed");
  });
});

describe("agentStageWork", () => {
  it("carries the failure a loop went back with", () => {
    expect(
      agentStageWork(
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
      '## The Stage: Implement\n\nBuild it.\n\n## Why this Stage runs again\n\n"Tests" failed after it, so the Pipeline went back here (round 1 of 2):\n\n1 fails.',
    );
  });

  it("carries the round the user gave the Stage itself, with their guidance", () => {
    const work = agentStageWork(
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
      { key: "implement", name: "Implement", brief: "Build it." },
      { sentBack: { gateKey: "look", gateName: "UI acceptance", feedback: "Name it Save." } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Sent back from UI acceptance\n\nThe user looked at the work so far at the Gate and sent it back to this Stage with their feedback. It is no failure: act on it, then end the Stage with its result.\n\nName it Save.",
    );
  });

  it("gives the user's answer to the question the Stage's Agent asked", () => {
    const work = agentStageWork(
      { key: "implement", name: "Implement", brief: "Build it." },
      { answered: { question: "Which page?", answer: "The list" } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Your question, answered\n\nYou asked the user: Which page?\n\nTheir answer: The list\n\nGo on with the Stage from there.",
    );
  });

  it("tells a Stage the user paused and resumed to go on with its edits", () => {
    const work = agentStageWork(
      { key: "implement", name: "Implement", brief: "Build it." },
      { held: { by: "pause" } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Paused by the user\n\nThe user paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.",
    );
  });

  it("tells a Stage the user stopped and resumed that its uncommitted edits are gone", () => {
    const work = agentStageWork(
      { key: "implement", name: "Implement", brief: "Build it." },
      { held: { by: "stop" } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## Stopped by the user\n\nThe user stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.",
    );
  });

  it("tells a Stage run again after a restart that its edits are gone, with the user's words", () => {
    const work = agentStageWork(
      { key: "implement", name: "Implement", brief: "Build it." },
      { held: { by: "restart", guidance: "Skip the dialog's tests." } },
    );

    expect(work).toBe(
      "## The Stage: Implement\n\nBuild it.\n\n## The Office restarted\n\nThe Office restarted while this Stage ran, which ended your session at once, and the user chose to run the Stage again. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.\n\nThe user's words for it:\n\nSkip the dialog's tests.",
    );
  });
});
