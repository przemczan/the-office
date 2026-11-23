import { describe, expect, it } from "vitest";
import {
  AGENT_STAGE_THREAD_INSTRUCTIONS,
  agentStageRecord,
  agentStageWork,
  restartedSessionWork,
  stageResultWords,
  workSentAgain,
  type AgentStageRecord,
  type BriefTask,
  type CarriedRound,
  type EarlierResult,
  type HeldRun,
  type RecheckedCommitMessage,
  type StagePipeline,
  type StageWorkReasons,
} from "./agent-stage-brief.js";
import { GATE_REACHED } from "./gate.js";
import { PUBLISH_COMMAND, type Stage } from "./stage.js";
import { agentStage, dutyStage, gate, goingBackOnFailure, scriptStage } from "./stage.fixtures.js";
import type { StageOutcome } from "./stage-run.js";
import { allowedCommands, type RunPermission } from "./allowed-commands.js";
import { hardSwitchesSection, type FollowedHardSwitchValue } from "./followed-hard-switches.js";
import { RESOLVE_AFTER_GATE, RESOLVE_AFTER_TEST } from "./resolve-stages.js";
import { branchMovedWords, branchUpdateWords, type BranchUpdate } from "./stage-commit.js";
import { correctionMessage } from "./stage-result.js";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { PIPELINES_PROMPT_TEMPLATES } from "./pipelines-prompt-templates.js";

const prompts = defaultPromptTexts(PIPELINES_PROMPT_TEMPLATES);

/**
 * Each of Pipelines' Prompt templates as it renders with its default text, pinned in full, so
 * moving a prompt into a template never changes a word of it. One describe per template.
 */

const ALLOWED: FollowedHardSwitchValue = { kind: "allowed" };
const INSTALL_CALL = "install anything that changes the machine outside the worktree";
const INSTALL_NOT =
  "Adding or updating the Project's own dependencies is a code change, not an install.";
const PUBLISH_CALL =
  "publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying";
const PUBLISH_NOT = "The Office publishes the Task's work itself once the Pipeline ends.";
const APPROVAL =
  "An approval is for that one call: Allow once lets you make it once, and Deny means you don't make it; go on without it, or end the Stage failed with the reason if you can't. Ask again for the next call.";

function hardSwitches(
  runInstalls: FollowedHardSwitchValue,
  publishOutsideThePipeline: FollowedHardSwitchValue,
): string {
  return hardSwitchesSection(prompts, { runInstalls, publishOutsideThePipeline });
}

describe("pipelines.hard-switches", () => {
  it("tells allowed switches as allowed, and asks for no approval", () => {
    expect(hardSwitches(ALLOWED, ALLOWED)).toBe(
      `## Hard switches\n\n- You may ${INSTALL_CALL} without asking. ${INSTALL_NOT}\n- You may ${PUBLISH_CALL} without asking. ${PUBLISH_NOT}`,
    );
  });

  it("sends a consulted switch to the consult tool, naming the person", () => {
    expect(hardSwitches({ kind: "consult", person: "Devops" }, ALLOWED)).toBe(
      `## Hard switches\n\n- Before you ${INSTALL_CALL}, consult Devops first: ask approval of the call with consult, naming Devops, and make it only once the answer is Allow once. ${INSTALL_NOT}\n- You may ${PUBLISH_CALL} without asking. ${PUBLISH_NOT}\n\n${APPROVAL}`,
    );
  });

  it("sends an Ask me switch to the consult tool, naming nobody", () => {
    expect(hardSwitches(ALLOWED, { kind: "ask-me" })).toBe(
      `## Hard switches\n\n- You may ${INSTALL_CALL} without asking. ${INSTALL_NOT}\n- Before you ${PUBLISH_CALL}, ask the user first: ask approval of the call with consult, naming no person, and make it only once the answer is Allow once. ${PUBLISH_NOT}\n\n${APPROVAL}`,
    );
  });

  it("tells a never switch as not allowed, with no approval for it alone", () => {
    expect(hardSwitches({ kind: "never" }, { kind: "never" })).toBe(
      `## Hard switches\n\n- You may not ${INSTALL_CALL}: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason. ${INSTALL_NOT}\n- You may not ${PUBLISH_CALL}: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason. ${PUBLISH_NOT}`,
    );
  });

  it("asks for approval once when only a later switch asks first", () => {
    expect(hardSwitches({ kind: "never" }, { kind: "consult", person: "the CTO" })).toBe(
      `## Hard switches\n\n- You may not ${INSTALL_CALL}: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason. ${INSTALL_NOT}\n- Before you ${PUBLISH_CALL}, consult the CTO first: ask approval of the call with consult, naming the CTO, and make it only once the answer is Allow once. ${PUBLISH_NOT}\n\n${APPROVAL}`,
    );
  });
});

const GIT = ["status", "diff"];
const GIT_WORDS = "read-only git (git status, git diff)";
const COMMANDS = [
  { key: "build", name: "Build", commandLine: "npm run build" },
  { key: "lint", name: "Lint", commandLine: "" },
  { key: "test", name: "Test", commandLine: "npm test" },
  { key: "test-full", name: "Full tests", commandLine: "npm run test:full" },
];
const ANYTHING = `You may run any command in the worktree, but no git command that changes anything: besides ${GIT_WORDS}, git is The Office's.`;

function commandWords(run: RunPermission, narrowing: readonly string[] | undefined): string {
  return allowedCommands(prompts, run, COMMANDS, narrowing, GIT).words;
}

describe("pipelines.brief-commands", () => {
  it("lets read-only git be run alone", () => {
    expect(commandWords("read-only-git", undefined)).toBe(`You may run ${GIT_WORDS} only.`);
    expect(commandWords("read-only-git", ["test"])).toBe(`You may run ${GIT_WORDS} only.`);
  });

  it("lists the Project's commands by key, name and command line, blank ones left out", () => {
    expect(commandWords("project-commands", undefined)).toBe(
      `You may run the Project's commands, exactly as written, and ${GIT_WORDS}:\n\n- build (Build): \`npm run build\`\n- test (Test): \`npm test\`\n- test-full (Full tests): \`npm run test:full\``,
    );
  });

  it("lists only the commands a Stage's narrowing keeps", () => {
    expect(commandWords("project-commands", ["test"])).toBe(
      `You may run the Project's commands, exactly as written, and ${GIT_WORDS}:\n\n- test (Test): \`npm test\``,
    );
  });

  it("says the Project has no commands when it has none", () => {
    expect(allowedCommands(prompts, "project-commands", [], undefined, GIT).words).toBe(
      `The Project has no commands to run, so you may run ${GIT_WORDS} only.`,
    );
  });

  it("says none is for the Stage when its narrowing keeps none", () => {
    expect(commandWords("project-commands", ["lint"])).toBe(
      `None of the Project's commands is for this Stage, so you may run ${GIT_WORDS} only.`,
    );
    expect(commandWords("project-commands", [])).toBe(
      `None of the Project's commands is for this Stage, so you may run ${GIT_WORDS} only.`,
    );
  });

  it("lets anything run but git that changes something, with no narrowing", () => {
    expect(commandWords("anything", undefined)).toBe(ANYTHING);
  });

  it("names the commands a narrowed Stage runs under anything, and the others", () => {
    expect(commandWords("anything", ["test"])).toBe(
      `${ANYTHING}\n\nOf the Project's own commands, run only these, by their key with run_project_command or exactly as written:\n\n- test (Test): \`npm test\`\n\nThe others (build, test-full) are not for this Stage.`,
    );
  });

  it("names no others when the narrowing keeps every command", () => {
    expect(commandWords("anything", ["build", "test", "test-full"])).toBe(
      `${ANYTHING}\n\nOf the Project's own commands, run only these, by their key with run_project_command or exactly as written:\n\n- build (Build): \`npm run build\`\n- test (Test): \`npm test\`\n- test-full (Full tests): \`npm run test:full\``,
    );
  });

  it("says none of the Project's own commands is for a Stage whose narrowing keeps none", () => {
    expect(commandWords("anything", ["lint"])).toBe(
      `${ANYTHING}\n\nNone of the Project's own commands is for this Stage.`,
    );
    expect(commandWords("anything", [])).toBe(
      `${ANYTHING}\n\nNone of the Project's own commands is for this Stage.`,
    );
  });
});

describe("pipelines.result-correction", () => {
  it("quotes one problem", () => {
    expect(correctionMessage(prompts, 'status "done" requires "handoverNote".')).toBe(
      `Your result didn't match the Stage's result schema:\n\nstatus "done" requires "handoverNote".\n\nDon't redo the work: answer again with the corrected result only.`,
    );
  });

  it("quotes several problems as given", () => {
    expect(
      correctionMessage(prompts, "✖ Too small: expected string\n  → at summary\n✖ Invalid input"),
    ).toBe(
      `Your result didn't match the Stage's result schema:\n\n✖ Too small: expected string\n  → at summary\n✖ Invalid input\n\nDon't redo the work: answer again with the corrected result only.`,
    );
  });

  it("writes the problems as they are, with no escaping", () => {
    expect(correctionMessage(prompts, `"a" <b> & 'c'`)).toBe(
      `Your result didn't match the Stage's result schema:\n\n"a" <b> & 'c'\n\nDon't redo the work: answer again with the corrected result only.`,
    );
  });
});

const BASES = "initiative/usage-exports, then main";
const COMMIT = "c".repeat(40);

function branchNews(update: BranchUpdate): string | undefined {
  return branchUpdateWords(prompts, update, BASES);
}

describe("pipelines.branch-news", () => {
  it("tells nothing when the branch was up to date", () => {
    expect(branchNews({ kind: "up-to-date" })).toBeUndefined();
  });

  it("tells a branch brought up to date, naming the bases", () => {
    expect(branchNews({ kind: "updated", commit: COMMIT })).toBe(
      "The Office brought the Task's branch up to date with initiative/usage-exports, then main as this Stage started, so the code may be newer than the Plan.",
    );
  });

  it("tells a conflict that left the branch as it was, naming the branch and the files", () => {
    expect(
      branchNews({ kind: "conflicted", conflictedFiles: ["a.ts", "b/c.ts"], from: "main" }),
    ).toBe(
      "The Task's branch is behind main and conflicts with it in a.ts, b/c.ts, so it stays as it was. When your work needs what the base has, call update_branch and resolve the conflict in the files.",
    );
  });

  it("names the bases for a conflict whose branch isn't known", () => {
    expect(branchNews({ kind: "conflicted", conflictedFiles: ["a.ts"] })).toBe(
      "The Task's branch is behind initiative/usage-exports, then main and conflicts with it in a.ts, so it stays as it was. When your work needs what the base has, call update_branch and resolve the conflict in the files.",
    );
  });

  it("tells a conflict after a clean merge of an earlier base", () => {
    expect(
      branchNews({
        kind: "conflicted",
        conflictedFiles: ["a.ts"],
        from: "main",
        commit: COMMIT,
      }),
    ).toBe(
      "The Task's branch is behind main and conflicts with it in a.ts, so it took in what came before it and stays without it. When your work needs what the base has, call update_branch and resolve the conflict in the files.",
    );
  });

  it("tells a failed update with what git said", () => {
    expect(branchNews({ kind: "failed", error: "fatal: couldn't read <origin> & 'more'" })).toBe(
      "The Office couldn't bring the Task's branch up to date with initiative/usage-exports, then main, so it may be behind. If your work needs what the base has, call update_branch. git said: fatal: couldn't read <origin> & 'more'",
    );
  });

  it("tells a branch that moved since the last Stage, by short commits", () => {
    expect(branchMovedWords(prompts, "a".repeat(40), "b".repeat(40))).toBe(
      "The Task's branch moved from aaaaaaaa to bbbbbbbb since the last Stage: read again whatever you read before.",
    );
  });
});

describe("pipelines.stage-thread-instructions", () => {
  it("is what an Agent is told in a Stage Thread, as before", () => {
    expect(prompts.render(AGENT_STAGE_THREAD_INSTRUCTIONS, {})).toBe(
      "In this Thread you work Stages of a Task's Pipeline, in the Task's worktree. Each Stage comes as a message saying what it asks, after the Task's Brief when your session is new. Work it through, checking your work with run_project_command: it runs one of the Project's commands by its key, or a command line you may run, such as one test file, where the Project's commands run (in the Task's run environment when the Project has one), and answers with the exit code and a file with the whole output. Your own shell runs on this computer, outside the run environment, so run the Project's checks with run_project_command, never by hand in your shell, and don't write a .env or start a database to make them run there. The Brief names the commands you may run. The Office commits your work after each Stage: you never commit, push or switch branches. The Stage ends when your turn ends, with your result, so finish within the turn whatever work you need: your sub-agents run in the foreground and answer within it, and you wait in it for anything else, such as a background command's output, never ending the turn to wait. Stop the background commands you no longer need before you end it. End the Stage with your result: done, with a summary, the numbers of the Definition of Done statements the work meets, and your Handover note (where you are, what is left, what to watch); needs_decision, once you asked and wait for the answer; or failed, with the reason, when you can't finish it. A Definition of Done statement you can't verify where you work, however many rounds you get, such as a live check on the user's workstation, you report as out of reach with why, never as met. A statement reported met, by you or an earlier Stage, stays met: the Brief marks those Reported met so far. One your work no longer meets, such as a regression you found, you list as no longer met, which takes it back. When a choice is the user's to make, open a Decision with open_decision, asking every question you have in that one Decision; when your brief or your authority says to consult someone first, use consult. Either returns at once: then end the Stage with needs_decision and your Handover note, and the answer comes as your next message. Small issues you find along the way, such as a typo, a missing check or a broken test beside your change, fix within this Task and name them in your Handover note. An issue too big for this Task or outside its scope, don't fix: propose a Bug Task with propose_bug_task, end the Stage with needs_decision, and go on with your own work once the answer comes, whichever it is. An answer of Fix now creates no Task: fix the issue within this Task, naming it in your Handover note, then go on. Write a screenshot of each screen you changed into the screenshots folder the Brief names and list it in your result's screenshots: The Office attaches exactly those. Attach anything else the user should see with the Task, such as a report, with attach_file or attach_link. Attach a design the user is to approve before its Gate, as one self-contained .html file: the preview loads nothing from outside the file. When your work needs something the base branch has and the Task's branch doesn't, call update_branch rather than asking anyone: The Office commits your work so far and brings the branch up to date. The Task's commit message is the message of the one commit Publish lands the Task as: when your work changes what it should say, update it with write_commit_message.",
    );
  });
});

describe("pipelines.resolve-after-test", () => {
  it("tells Resolve's Agent to fix what the merge left broken", () => {
    expect(prompts.render(RESOLVE_AFTER_TEST, {})).toBe(
      "The Project's Test failed after The Office merged the base branch into the Task's branch. Fix what the merge left broken, as the failure below shows, keeping what both sides meant. Don't run git: The Office commits your changes.",
    );
  });
});

describe("pipelines.resolve-after-gate", () => {
  it("tells Resolve's Agent to change what the user's feedback asks", () => {
    expect(prompts.render(RESOLVE_AFTER_GATE, {})).toBe(
      "The user reviewed how the conflict with the base branch was resolved and sent it back. The merge is committed already: change what their feedback below asks, keeping what both sides meant. Don't run git: The Office commits your changes.",
    );
  });
});

/** Each case renders one way and is pinned to its whole text. */
type Pin = readonly [name: string, render: () => string | undefined, expected: string | undefined];

function pinned(pins: readonly Pin[]): void {
  it.each(pins)("%s", (_name, render, expected) => {
    expect(render()).toBe(expected);
  });
}

const STAGE = { key: "implement", name: "Implement", brief: "Build it.\nKeep it small." };
const BEN = { userId: "u-2", name: "Ben Ito" };
const WORDS = "Use the new API.\nNot the old one.";

function held(run: HeldRun): string {
  return agentStageWork(prompts, STAGE, { held: run });
}

describe("pipelines.stage-held", () => {
  pinned([
    [
      "not started, with no words",
      () => held({ by: "restart", notStarted: true }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.",
    ],
    [
      "not started, with the user's words",
      () => held({ by: "restart", notStarted: true, guidance: WORDS }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## The user's words for this Stage\n\nUse the new API.\nNot the old one.",
    ],
    [
      "stopped by a user",
      () => held({ by: "stop", byUser: BEN }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Stopped by the user Ben Ito\n\nThe user Ben Ito stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.",
    ],
    [
      "stopped before users existed",
      () => held({ by: "stop" }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Stopped by the user\n\nThe user stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.",
    ],
    [
      "stopped, cut short, with words",
      () => held({ by: "stop", byUser: BEN, cutShort: true, guidance: WORDS }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Stopped by the user Ben Ito\n\nThe user Ben Ito stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.\n\nThe user's words for it:\n\nUse the new API.\nNot the old one.",
    ],
    [
      "paused by a user",
      () => held({ by: "pause", byUser: BEN }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused by the user Ben Ito\n\nThe user Ben Ito paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.",
    ],
    [
      "paused, cut short",
      () => held({ by: "pause", byUser: BEN, cutShort: true }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused by the user Ben Ito\n\nThe user Ben Ito paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.\n\nThe Office restarted during your last turn, which it cut short, so some of your edits may be half-done: check them before you go on.",
    ],
    [
      "paused, cut short, with words",
      () => held({ by: "pause", cutShort: true, guidance: WORDS }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused by the user\n\nThe user paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.\n\nThe Office restarted during your last turn, which it cut short, so some of your edits may be half-done: check them before you go on.\n\nThe user's words for it:\n\nUse the new API.\nNot the old one.",
    ],
    [
      "held by the fire alarm",
      () => held({ by: "alarm" }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Held by the fire alarm\n\nThe user sounded the fire alarm while this Stage ran, which held it after your last turn, and has given the all clear. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.",
    ],
    [
      "held by the fire alarm, cut short",
      () => held({ by: "alarm", cutShort: true }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Held by the fire alarm\n\nThe user sounded the fire alarm while this Stage ran, which held it after your last turn, and has given the all clear. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.\n\nThe Office cut your last turn short, so some of your edits may be half-done: check them before you go on.",
    ],
    [
      "paused for the usage window",
      () => held({ by: "usage-window" }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused for the usage window\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage until the window reset, and has resumed it now. Your edits are in the worktree as you left them.",
    ],
    [
      "paused for the usage window, the work refused",
      () => held({ by: "usage-window", refused: { message: "work" } }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused for the usage window\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage until the window reset, and has resumed it now. Your edits are in the worktree as you left them.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was this Stage's work, above: do it now, and end with its result.",
    ],
    [
      "paused for the usage window, the correction refused",
      () =>
        held({ by: "usage-window", refused: { message: "correction", problems: "✖ No summary" } }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused for the usage window\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage until the window reset, and has resumed it now. Your edits are in the worktree as you left them.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was The Office's request to correct your result, sent again:\n\nYour result didn't match the Stage's result schema:\n\n✖ No summary\n\nDon't redo the work: answer again with the corrected result only.",
    ],
    [
      "paused for the usage window, the correction refused with no problems kept",
      () => held({ by: "usage-window", refused: { message: "correction" } }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused for the usage window\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage until the window reset, and has resumed it now. Your edits are in the worktree as you left them.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was The Office's request to correct your result, sent again:\n\nYour result didn't match the Stage's result schema:\n\n\n\nDon't redo the work: answer again with the corrected result only.",
    ],
    [
      "a Stand-in Engine chosen",
      () =>
        held({
          by: "usage-window",
          standInChosen: { engineName: "Codex", chosenBy: BEN },
        }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused for the usage window\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage. It goes on on Codex, as the user Ben Ito chose, in this same session. Your edits are in the worktree as you left them.",
    ],
    [
      "a Stand-in Engine chosen, the work refused, with words",
      () =>
        held({
          by: "usage-window",
          standInChosen: { engineName: "Codex", chosenBy: BEN },
          refused: { message: "work" },
          guidance: WORDS,
        }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused for the usage window\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage. It goes on on Codex, as the user Ben Ito chose, in this same session. Your edits are in the worktree as you left them.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was this Stage's work, above: do it now, and end with its result.\n\nThe user's words for it:\n\nUse the new API.\nNot the old one.",
    ],
    [
      "The Office restarted",
      () => held({ by: "restart" }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## The Office restarted\n\nThe Office restarted while this Stage ran, which cut your last turn short, and the Stage goes on now. The Stage's uncommitted edits are still in the worktree, but the cut may have left one half-done, such as a file half-written: check `git status` and `git diff` first, then go on with the Stage's work from there, and end with its result.",
    ],
    [
      "The Office restarted, cut short, with words",
      () => held({ by: "restart", cutShort: true, guidance: WORDS }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## The Office restarted\n\nThe Office restarted while this Stage ran, which cut your last turn short, and the Stage goes on now. The Stage's uncommitted edits are still in the worktree, but the cut may have left one half-done, such as a file half-written: check `git status` and `git diff` first, then go on with the Stage's work from there, and end with its result.\n\nThe user's words for it:\n\nUse the new API.\nNot the old one.",
    ],
    [
      "paused, cut short and refused",
      () => held({ by: "pause", byUser: BEN, cutShort: true, refused: { message: "work" } }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Paused by the user Ben Ito\n\nThe user Ben Ito paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was this Stage's work, above: do it now, and end with its result.",
    ],
  ]);
});

const ROUND = { error: "It broke.\nTwice.", round: 2, rounds: 3 };

function again(carried: CarriedRound): string {
  return agentStageWork(prompts, STAGE, { carried });
}

describe("pipelines.stage-runs-again", () => {
  pinned([
    [
      "one more round the user chose",
      () => again({ ...ROUND, stageKey: "implement", stageName: "Implement" }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Why this Stage runs again\n\nThe user chose one more round of this Stage after:\n\nIt broke.\nTwice.",
    ],
    [
      "one more round the user chose, with guidance",
      () => again({ ...ROUND, stageKey: "implement", stageName: "Implement", guidance: WORDS }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Why this Stage runs again\n\nThe user chose one more round of this Stage after:\n\nIt broke.\nTwice.\n\nThe user's guidance for this round:\n\nUse the new API.\nNot the old one.",
    ],
    [
      "one more round a Consultant chose",
      () =>
        again({
          ...ROUND,
          stageKey: "implement",
          stageName: "Implement",
          guide: "Bob (Architect)",
        }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Why this Stage runs again\n\nOne more round of this Stage was chosen by Bob (Architect) after:\n\nIt broke.\nTwice.",
    ],
    [
      "one more round a Consultant chose, with guidance",
      () =>
        again({
          ...ROUND,
          stageKey: "implement",
          stageName: "Implement",
          guide: "Bob (Architect)",
          guidance: WORDS,
        }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Why this Stage runs again\n\nOne more round of this Stage was chosen by Bob (Architect) after:\n\nIt broke.\nTwice.\n\nGuidance for this round from Bob (Architect):\n\nUse the new API.\nNot the old one.",
    ],
    [
      "a later Stage's loop went back",
      () => again({ ...ROUND, stageKey: "tests", stageName: "Tests" }),
      '## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Why this Stage runs again\n\n"Tests" failed after it, so the Pipeline went back here (round 2 of at most 3):\n\nIt broke.\nTwice.',
    ],
    [
      "a later Stage's loop went back, with the user's guidance",
      () => again({ ...ROUND, stageKey: "tests", stageName: "Tests", guidance: WORDS }),
      '## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Why this Stage runs again\n\n"Tests" failed after it, so the Pipeline went back here (round 2 of at most 3):\n\nIt broke.\nTwice.\n\nThe user\'s guidance for this round:\n\nUse the new API.\nNot the old one.',
    ],
    [
      "a later Stage's loop went back, with a Consultant's guidance",
      () =>
        again({
          ...ROUND,
          stageKey: "tests",
          stageName: "Tests",
          guide: "the Architect",
          guidance: WORDS,
        }),
      '## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Why this Stage runs again\n\n"Tests" failed after it, so the Pipeline went back here (round 2 of at most 3):\n\nIt broke.\nTwice.\n\nGuidance for this round from the Architect:\n\nUse the new API.\nNot the old one.',
    ],
  ]);
});

describe("pipelines.stage-sent-again", () => {
  pinned([
    [
      "the work, sent again",
      () => workSentAgain(prompts, { message: "work" }),
      "## Gone on on a Stand-in Engine\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office moved this session to a Stand-in Engine, where it goes on now. Your edits are in the worktree as you left them.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was this Stage's work, above: do it now, and end with its result.",
    ],
    [
      "the correction, sent again",
      () => workSentAgain(prompts, { message: "correction", problems: "✖ No summary" }),
      "## Gone on on a Stand-in Engine\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office moved this session to a Stand-in Engine, where it goes on now. Your edits are in the worktree as you left them.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was The Office's request to correct your result, sent again:\n\nYour result didn't match the Stage's result schema:\n\n✖ No summary\n\nDon't redo the work: answer again with the corrected result only.",
    ],
    [
      "the correction with no problems kept, sent again",
      () => workSentAgain(prompts, { message: "correction" }),
      "## Gone on on a Stand-in Engine\n\nYour engine refused your last turn because a usage window of its account was used up, so The Office moved this session to a Stand-in Engine, where it goes on now. Your edits are in the worktree as you left them.\n\nThe engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.\n\nThe message the engine refused was The Office's request to correct your result, sent again:\n\nYour result didn't match the Stage's result schema:\n\n\n\nDon't redo the work: answer again with the corrected result only.",
    ],
  ]);
});

const ASKED: StageOutcome = {
  status: "needs-decision",
  question: "Which page?",
  context: "",
  options: ["The device page"],
  recommendation: { option: 0, reason: "Room." },
};
const NOTES = "Build version B.\nKeep the colours.";

function result(earlier: EarlierResult): string {
  return stageResultWords(prompts, earlier);
}

describe("pipelines.earlier-stage-result", () => {
  pinned([
    [
      "done",
      () =>
        result({
          stageName: "Implement",
          kind: "agent",
          outcome: { status: "done", summary: "Added it.", handoverNote: "Check the list." },
        }),
      "- Implement (Agent Stage): done. Added it.",
    ],
    [
      "asked the user",
      () => result({ stageName: "Implement", kind: "agent", outcome: ASKED }),
      '- Implement (Agent Stage): asked the user "Which page?"',
    ],
    [
      "failed",
      () =>
        result({
          stageName: "Tests",
          kind: "script",
          outcome: { status: "failed", error: "1 fails." },
        }),
      "- Tests (Script Stage): failed. 1 fails.",
    ],
    [
      "a Gate the user let continue with notes",
      () => result({ stageName: "Look", kind: "gate", outcome: GATE_REACHED, gateNotes: NOTES }),
      "- Look (Gate): the user let the work continue, with notes for the Stages after it. Follow them:\n  Build version B.\n  Keep the colours.",
    ],
    [
      "done, with the notes of the route the user chose",
      () =>
        result({
          stageName: "Implement",
          kind: "agent",
          outcome: { status: "done", summary: "Added it." },
          routeNotes: NOTES,
        }),
      "- Implement (Agent Stage): done. Added it.\n  None of its routes held, so the user chose where the work goes on, with notes for the Stages after it. Follow them:\n  Build version B.\n  Keep the colours.",
    ],
    [
      "a Gate with notes, and route notes",
      () =>
        result({
          stageName: "Look",
          kind: "gate",
          outcome: GATE_REACHED,
          gateNotes: NOTES,
          routeNotes: "Skip the review.",
        }),
      "- Look (Gate): the user let the work continue, with notes for the Stages after it. Follow them:\n  Build version B.\n  Keep the colours.\n  None of its routes held, so the user chose where the work goes on, with notes for the Stages after it. Follow them:\n  Skip the review.",
    ],
    [
      "failed, with route notes",
      () =>
        result({
          stageName: "Tests",
          kind: "script",
          outcome: { status: "failed", error: "1 fails.\n2 fails." },
          routeNotes: NOTES,
        }),
      "- Tests (Script Stage): failed. 1 fails.\n2 fails.\n  None of its routes held, so the user chose where the work goes on, with notes for the Stages after it. Follow them:\n  Build version B.\n  Keep the colours.",
    ],
  ]);
});

const IMPLEMENT = agentStage({ key: "implement", name: "Implement", brief: STAGE.brief });
const LATER: readonly Stage[] = [
  IMPLEMENT,
  goingBackOnFailure(
    agentStage({
      key: "review",
      name: "Review",
      role: "reviewer",
      brief: "Review it.\nCarefully.",
    }),
    "implement",
    2,
  ),
  dutyStage("asked-first-when-out-of-tries", { key: "ask", name: "Ask", brief: "Ask." }),
  agentStage({ key: "nobody", name: "Nobody", role: undefined, brief: "Nobody's." }),
  gate({ key: "look", name: "Look" }),
  goingBackOnFailure(scriptStage({ key: "tests", name: "Tests", command: "test" }), "implement", 3),
  goingBackOnFailure(scriptStage({ key: "lint", name: "Lint", command: "lint" }), "review", 1),
  scriptStage({ key: "publish", name: "Publish", command: PUBLISH_COMMAND }),
];
const PIPELINE: StagePipeline = {
  stages: LATER,
  commands: [{ key: "test", commandLine: "npm test" }],
  roleTitle: (roleKey) => (roleKey === "reviewer" ? "Reviewer" : "Developer"),
};
const LAST: StagePipeline = { ...PIPELINE, stages: [IMPLEMENT] };
const BEFORE_PUBLISH: StagePipeline = {
  ...PIPELINE,
  stages: [IMPLEMENT, scriptStage(), scriptStage({ key: "publish", command: PUBLISH_COMMAND })],
};
const RECHECKED: RecheckedCommitMessage = {
  text: "Rename a device\n\nAdds a rename dialog.",
  written: true,
  landsOn: "main",
  changesFrom: ["refs/remotes/origin/main"],
};

function work(reasons: StageWorkReasons): string {
  return agentStageWork(prompts, STAGE, reasons);
}

describe("pipelines.stage-handover", () => {
  pinned([
    [
      "the earlier session's Handover note",
      () =>
        restartedSessionWork(prompts, {
          work: "## The Stage: Implement",
          handoverNote: "The dialog is in; its tests are left.",
        }),
      "## Handover note from this Stage's earlier session\n\nThis Stage began in an earlier session, whose context grew past its limit, so The Office goes on with the Stage in this fresh session. That session's edits are in the worktree, uncommitted: go on from where it left the work, without redoing what is done, and end the Stage with its result.\n\nIts Handover note:\n\nThe dialog is in; its tests are left.\n\n## The Stage: Implement",
    ],
    [
      "no Handover note written",
      () =>
        restartedSessionWork(prompts, {
          work: "## The Stage: Implement",
          handoverNote: undefined,
        }),
      "## Handover note from this Stage's earlier session\n\nThis Stage began in an earlier session, whose context grew past its limit, so The Office goes on with the Stage in this fresh session. That session's edits are in the worktree, uncommitted: go on from where it left the work, without redoing what is done, and end the Stage with its result.\n\nIt wrote no Handover note: check the worktree's diff first (`git status` and `git diff`) to see where it left the work.\n\n## The Stage: Implement",
    ],
  ]);
});

describe("pipelines.stage-message", () => {
  pinned([
    ["the Stage alone", () => work({}), "## The Stage: Implement\n\nBuild it.\nKeep it small."],
    [
      "the last Stage of the Pipeline",
      () => work({ pipeline: LAST }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Later Stages\n\nNo Stage comes after this one in the Task's Pipeline.",
    ],
    [
      "Stages of every kind after it, with a commit message it doesn't recheck",
      () => work({ pipeline: PIPELINE, commitMessage: RECHECKED }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n- Review (Agent Stage, Reviewer): Review it.\n  Carefully. If it fails, the work comes back here.\n- Ask (Agent Stage, Asked first when a Stage runs out of tries, nobody holds it): Ask.\n- Nobody (Agent Stage, nobody chosen yet): Nobody's.\n- Look (Gate): the user looks at the work there and lets it continue or sends it back.\n- Tests (Script Stage): runs `npm test`. If it fails, the work comes back here.\n- Lint (Script Stage): runs the Project's command lint, which isn't set.\n- Publish (Script Stage): The Office publishes the Task's work.\n\nWhile you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.",
    ],
    [
      "the last Agent Stage before Publish, its commit message written",
      () => work({ pipeline: BEFORE_PUBLISH, commitMessage: RECHECKED }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n- Tests (Script Stage): runs `npm test`.\n- Tests (Script Stage): The Office publishes the Task's work.\n\nWhile you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.\n\n## Recheck the commit message\n\nYours is the last Agent Stage before Publish, which lands the Task on main as one commit with the Task's commit message. Before you end the Stage, read the Task's whole diff (`git diff origin/main...HEAD`; the Brief's \"What changed so far\" summarises it), check the message against that diff and the commit convention the Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like), and fix it with write_commit_message where it no longer fits. It reads now:\n\n```\nRename a device\n\nAdds a rename dialog.\n```",
    ],
    [
      "the last Agent Stage before Publish, no commit message written, no base",
      () =>
        work({
          pipeline: BEFORE_PUBLISH,
          commitMessage: {
            text: "Use ``` fences",
            written: false,
            landsOn: "main",
            changesFrom: [],
          },
        }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n- Tests (Script Stage): runs `npm test`.\n- Tests (Script Stage): The Office publishes the Task's work.\n\nWhile you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.\n\n## Recheck the commit message\n\nYours is the last Agent Stage before Publish, which lands the Task on main as one commit with the Task's commit message. Before you end the Stage, read the Task's whole diff (`git diff HEAD`; the Brief's \"What changed so far\" summarises it), check the message against that diff and the commit convention the Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like), and fix it with write_commit_message where it no longer fits. None is written, so Publish would use the default:\n\n````\nUse ``` fences\n````",
    ],
    [
      "the last Agent Stage before Publish, on two bases",
      () =>
        work({
          pipeline: BEFORE_PUBLISH,
          commitMessage: {
            ...RECHECKED,
            landsOn: "initiative/sign-in",
            changesFrom: ["refs/heads/initiative/sign-in", "refs/remotes/origin/main"],
          },
        }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n- Tests (Script Stage): runs `npm test`.\n- Tests (Script Stage): The Office publishes the Task's work.\n\nWhile you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.\n\n## Recheck the commit message\n\nYours is the last Agent Stage before Publish, which lands the Task on initiative/sign-in as one commit with the Task's commit message. Before you end the Stage, read the Task's whole diff (`git log -p --no-merges HEAD --not initiative/sign-in origin/main`, its own commits without what the bases brought in; the Brief's \"What changed so far\" summarises it), check the message against that diff and the commit convention the Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like), and fix it with write_commit_message where it no longer fits. It reads now:\n\n```\nRename a device\n\nAdds a rename dialog.\n```",
    ],
    [
      "a question answered",
      () => work({ answered: { question: "Which page?", answer: "The device page.\nOnly it." } }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Your question, answered\n\nYou asked the user: Which page?\n\nTheir answer: The device page.\nOnly it.\n\nGo on with the Stage from there.",
    ],
    [
      "sent back from a Gate",
      () => work({ sentBack: { gateKey: "look", gateName: "Look", feedback: NOTES } }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Sent back from Look\n\nThe user looked at the work so far at the Gate and sent it back to this Stage with their feedback. It is no failure: act on it, then end the Stage with its result.\n\nBuild version B.\nKeep the colours.",
    ],
    [
      "the install failed",
      () => work({ installProblem: "npm ci failed.\nENOSPC" }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## The install before this Stage\n\nnpm ci failed.\nENOSPC\n\nCommands that need the dependencies may fail until it passes. If the Task's changes broke it, fix that first; The Office installs again before the next Stage.",
    ],
    [
      "every reason at once",
      () =>
        work({
          pipeline: BEFORE_PUBLISH,
          commitMessage: RECHECKED,
          held: { by: "pause", byUser: BEN },
          answered: { question: "Which page?", answer: "The device page." },
          carried: { ...ROUND, stageKey: "tests", stageName: "Tests" },
          sentBack: { gateKey: "look", gateName: "Look", feedback: NOTES },
          installProblem: "npm ci failed.",
        }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.\n\n## Later Stages\n\nThese Stages come after this one in the Task's Pipeline, in order:\n\n- Tests (Script Stage): runs `npm test`.\n- Tests (Script Stage): The Office publishes the Task's work.\n\nWhile you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.\n\n## Recheck the commit message\n\nYours is the last Agent Stage before Publish, which lands the Task on main as one commit with the Task's commit message. Before you end the Stage, read the Task's whole diff (`git diff origin/main...HEAD`; the Brief's \"What changed so far\" summarises it), check the message against that diff and the commit convention the Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like), and fix it with write_commit_message where it no longer fits. It reads now:\n\n```\nRename a device\n\nAdds a rename dialog.\n```\n\n## Paused by the user Ben Ito\n\nThe user Ben Ito paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.\n\n## Your question, answered\n\nYou asked the user: Which page?\n\nTheir answer: The device page.\n\nGo on with the Stage from there.\n\n## Why this Stage runs again\n\n\"Tests\" failed after it, so the Pipeline went back here (round 2 of at most 3):\n\nIt broke.\nTwice.\n\n## Sent back from Look\n\nThe user looked at the work so far at the Gate and sent it back to this Stage with their feedback. It is no failure: act on it, then end the Stage with its result.\n\nBuild version B.\nKeep the colours.\n\n## The install before this Stage\n\nnpm ci failed.\n\nCommands that need the dependencies may fail until it passes. If the Task's changes broke it, fix that first; The Office installs again before the next Stage.",
    ],
    [
      "held, not started, with no words, and nothing else",
      () => work({ held: { by: "restart", notStarted: true } }),
      "## The Stage: Implement\n\nBuild it.\nKeep it small.",
    ],
  ]);
});

const BRIEF_TASK: BriefTask = {
  title: "Rename a device",
  descriptionSection: "## What the user wants, in their own words\n\nLet me name my devices.",
  plan: "",
  definitionOfDone: [],
  commitMessage: { text: "Rename a device", written: false },
  attachmentLines: [],
  linkedRecordsSection: undefined,
  connectedDeviceLines: [],
  whoAskedSection: "## Who asked\n\nThe Task was created by the user Ann Lee.",
  projectName: "Admin panel",
  baseBranch: "main",
  worktree: { path: "/worktrees/task", branch: "office/task", screenshotsFolder: ".shots" },
};
const ALLOWED_SWITCHES = { runInstalls: ALLOWED, publishOutsideThePipeline: ALLOWED };

function brief(
  task: Partial<BriefTask>,
  more: Partial<Omit<AgentStageRecord, "task">> = {},
): string {
  return agentStageRecord(prompts, {
    task: { ...BRIEF_TASK, ...task },
    earlier: [],
    diffSummary: undefined,
    commands: allowedCommands(prompts, "read-only-git", COMMANDS, undefined, GIT),
    hardSwitches: ALLOWED_SWITCHES,
    ...more,
  });
}

describe("pipelines.stage-brief", () => {
  pinned([
    [
      "the least a Task has",
      () => brief({}),
      "## The Task\n\nRename a device, in the Project Admin panel.\n\n## Who asked\n\nThe Task was created by the user Ann Lee.\n\n## What the user wants, in their own words\n\nLet me name my devices.\n\n## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, which started from main.\n\nScreenshots go in .shots/ there: git ignores it, and The Office keeps it as you leave it across test runs.\n\n## The commit message\n\nNone is written yet, so Publish lands the Task as one commit with the default, its title with a short summary below it:\n\n```\nRename a device\n```\n\nUpdate it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.\n\n## Attachments\n\nNone.\n\n## Commands you may run\n\nYou may run read-only git (git status, git diff) only.\n\nRun them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.\n\nThe Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.\n\n## Hard switches\n\n- You may install anything that changes the machine outside the worktree without asking. Adding or updating the Project's own dependencies is a code change, not an install.\n- You may publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying without asking. The Office publishes the Task's work itself once the Pipeline ends.",
    ],
    [
      "everything a Task can have",
      () =>
        brief(
          {
            plan: "1. Add the dialog.\n2. Save the name.",
            definitionOfDone: ["The name shows", "The name persists", "It runs live"],
            commitMessage: { text: "Rename a device\n\nUses ``` and `code`.", written: true },
            attachmentLines: ["- att-1: design.html (text/html)", "- att-2: shot.png (image/png)"],
            linkedRecordsSection: "## Linked records\n\n- Idea idea-1: Devices",
          },
          {
            earlier: [
              {
                stageName: "Implement",
                kind: "agent",
                outcome: {
                  status: "done",
                  summary: "Added it.",
                  definitionOfDoneMet: [1, 3],
                  handoverNote: "Check the list.\nAnd the dialog.",
                },
              },
              { stageName: "Look", kind: "gate", outcome: GATE_REACHED, gateNotes: NOTES },
              {
                stageName: "Tests",
                kind: "script",
                outcome: { status: "failed", error: "1 fails.", handoverNote: "Flaky." },
                routeNotes: "Go on.",
              },
              { stageName: "Review", kind: "agent", outcome: ASKED },
            ],
            diffSummary: "2 files changed\n a.ts | 2 +-",
            commands: allowedCommands(prompts, "project-commands", COMMANDS, undefined, GIT),
            hardSwitches: {
              runInstalls: { kind: "consult", person: "Devops" },
              publishOutsideThePipeline: { kind: "never" },
            },
          },
        ),
      "## The Task\n\nRename a device, in the Project Admin panel.\n\n## Who asked\n\nThe Task was created by the user Ann Lee.\n\n## What the user wants, in their own words\n\nLet me name my devices.\n\n## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, which started from main.\n\nScreenshots go in .shots/ there: git ignores it, and The Office keeps it as you leave it across test runs.\n\n## The Plan\n\n1. Add the dialog.\n2. Save the name.\n\n## The Definition of Done\n\n1. The name shows (Reported met so far)\n2. The name persists\n3. It runs live (Reported met so far)\n\n## The commit message\n\nPublish lands the Task as one commit with this message:\n\n````\nRename a device\n\nUses ``` and `code`.\n````\n\nUpdate it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.\n\n## Earlier Stages\n\n- Implement (Agent Stage): done. Added it.\n  Handover note: Check the list.\nAnd the dialog.\n- Look (Gate): the user let the work continue, with notes for the Stages after it. Follow them:\n  Build version B.\n  Keep the colours.\n- Tests (Script Stage): failed. 1 fails.\n  None of its routes held, so the user chose where the work goes on, with notes for the Stages after it. Follow them:\n  Go on.\n  Handover note: Flaky.\n- Review (Agent Stage): asked the user \"Which page?\"\n\n## What changed so far\n\n2 files changed\n a.ts | 2 +-\n\n## Linked records\n\n- Idea idea-1: Devices\n\n## Attachments\n\nRead one with read_attachment, by its id: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase; an image as a picture where the engine shows one; any other file by its name, kind and size.\n\n- att-1: design.html (text/html)\n- att-2: shot.png (image/png)\n\n## Commands you may run\n\nYou may run the Project's commands, exactly as written, and read-only git (git status, git diff):\n\n- build (Build): `npm run build`\n- test (Test): `npm test`\n- test-full (Full tests): `npm run test:full`\n\nRun them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.\n\nThe Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.\n\n## Hard switches\n\n- Before you install anything that changes the machine outside the worktree, consult Devops first: ask approval of the call with consult, naming Devops, and make it only once the answer is Allow once. Adding or updating the Project's own dependencies is a code change, not an install.\n- You may not publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying: it is not allowed for your Role, and nobody can approve it. If the Stage can't be done without it, end the Stage failed with the reason. The Office publishes the Task's work itself once the Pipeline ends.\n\nAn approval is for that one call: Allow once lets you make it once, and Deny means you don't make it; go on without it, or end the Stage failed with the reason if you can't. Ask again for the next call.",
    ],
    [
      "a Task of an Initiative",
      () => brief({ initiativeBranch: "initiative/sign-in" }),
      "## The Task\n\nRename a device, in the Project Admin panel.\n\n## Who asked\n\nThe Task was created by the user Ann Lee.\n\n## What the user wants, in their own words\n\nLet me name my devices.\n\n## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, which started from the Initiative's branch initiative/sign-in, and its Publish lands it on initiative/sign-in as one commit, not on main. The Office brings initiative/sign-in, then main into it.\n\nScreenshots go in .shots/ there: git ignores it, and The Office keeps it as you leave it across test runs.\n\n## The commit message\n\nNone is written yet, so Publish lands the Task as one commit with the default, its title with a short summary below it:\n\n```\nRename a device\n```\n\nUpdate it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.\n\n## Attachments\n\nNone.\n\n## Commands you may run\n\nYou may run read-only git (git status, git diff) only.\n\nRun them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.\n\nThe Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.\n\n## Hard switches\n\n- You may install anything that changes the machine outside the worktree without asking. Adding or updating the Project's own dependencies is a code change, not an install.\n- You may publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying without asking. The Office publishes the Task's work itself once the Pipeline ends.",
    ],
    [
      "a Publishing Task, by pull request",
      () =>
        brief({
          initiativeBranch: "initiative/sign-in",
          publishingTask: true,
          publishingMode: "push-and-pull-request",
        }),
      "## The Task\n\nRename a device, in the Project Admin panel.\n\n## Who asked\n\nThe Task was created by the user Ann Lee.\n\n## What the user wants, in their own words\n\nLet me name my devices.\n\n## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, the Initiative's own. Its worktree holds initiative/sign-in itself, the Initiative's whole change in this Project; Publish puts it into main by a pull request from initiative/sign-in into main. The Office brings main into it.\n\nScreenshots go in .shots/ there: git ignores it, and The Office keeps it as you leave it across test runs.\n\n## The commit message\n\nNone is written yet, so Publish lands the Task as one commit with the default, its title with a short summary below it:\n\n```\nRename a device\n```\n\nUpdate it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.\n\n## Attachments\n\nNone.\n\n## Commands you may run\n\nYou may run read-only git (git status, git diff) only.\n\nRun them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.\n\nThe Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.\n\n## Hard switches\n\n- You may install anything that changes the machine outside the worktree without asking. Adding or updating the Project's own dependencies is a code change, not an install.\n- You may publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying without asking. The Office publishes the Task's work itself once the Pipeline ends.",
    ],
    [
      "a Publishing Task, by merge",
      () =>
        brief({
          initiativeBranch: "initiative/sign-in",
          publishingTask: true,
          publishingMode: "merge",
        }),
      "## The Task\n\nRename a device, in the Project Admin panel.\n\n## Who asked\n\nThe Task was created by the user Ann Lee.\n\n## What the user wants, in their own words\n\nLet me name my devices.\n\n## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, the Initiative's own. Its worktree holds initiative/sign-in itself, the Initiative's whole change in this Project; Publish puts it into main by the base merged in with one merge commit, then main fast-forwarded. The Office brings main into it.\n\nScreenshots go in .shots/ there: git ignores it, and The Office keeps it as you leave it across test runs.\n\n## The commit message\n\nNone is written yet, so Publish lands the Task as one commit with the default, its title with a short summary below it:\n\n```\nRename a device\n```\n\nUpdate it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.\n\n## Attachments\n\nNone.\n\n## Commands you may run\n\nYou may run read-only git (git status, git diff) only.\n\nRun them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.\n\nThe Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.\n\n## Hard switches\n\n- You may install anything that changes the machine outside the worktree without asking. Adding or updating the Project's own dependencies is a code change, not an install.\n- You may publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying without asking. The Office publishes the Task's work itself once the Pipeline ends.",
    ],
    [
      "a Publishing Task off an Initiative's branch is a plain Task",
      () => brief({ publishingTask: true }),
      "## The Task\n\nRename a device, in the Project Admin panel.\n\n## Who asked\n\nThe Task was created by the user Ann Lee.\n\n## What the user wants, in their own words\n\nLet me name my devices.\n\n## Where you work\n\nThe Task's worktree, at /worktrees/task on the branch office/task, which started from main.\n\nScreenshots go in .shots/ there: git ignores it, and The Office keeps it as you leave it across test runs.\n\n## The commit message\n\nNone is written yet, so Publish lands the Task as one commit with the default, its title with a short summary below it:\n\n```\nRename a device\n```\n\nUpdate it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.\n\n## Attachments\n\nNone.\n\n## Commands you may run\n\nYou may run read-only git (git status, git diff) only.\n\nRun them in the worktree, where your session starts, with paths relative to it; never `cd` to an absolute path, as that stops the Stage to ask for approval.\n\nThe Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.\n\n## Hard switches\n\n- You may install anything that changes the machine outside the worktree without asking. Adding or updating the Project's own dependencies is a code change, not an install.\n- You may publish anything outside the Pipeline, such as pushing a branch, opening a pull request, releasing or deploying without asking. The Office publishes the Task's work itself once the Pipeline ends.",
    ],
  ]);
});
