import { describe, expect, it } from "vitest";
import {
  agentStageRecord,
  agentStageWork,
  isLastAgentStageBeforePublish,
  type BriefTask,
  type StagePipeline,
} from "./agent-stage-brief.js";
import { allowedCommands } from "./allowed-commands.js";
import { RESOLVE_KEY } from "./resolve-stages.js";
import type { AgentStage, Stage } from "./stage.js";

const WHO_ASKED =
  "## Who asked\n\nThe Task was created by the user Ann Lee and started by the queue, as its turn came (queued by the user Ben Ito).";

const task: BriefTask = {
  title: "Rename a device",
  descriptionSection: "## What the user wants, in their own words\n\nLet me name my devices.",
  plan: "",
  definitionOfDone: [],
  commitMessage: { text: "Rename a device", written: false },
  attachmentLines: [],
  linkedRecordsSection: undefined,
  whoAskedSection: WHO_ASKED,
  projectName: "Admin panel",
  baseBranch: "main",
  worktree: { path: "/worktrees/task", branch: "office/task", screenshotsFolder: ".shots" },
};

describe("an Agent Stage's Brief says which user asked", () => {
  it("names who created the Task and who started or queued it, right after the Task", () => {
    const record = agentStageRecord({
      task,
      earlier: [],
      diffSummary: undefined,
      commands: allowedCommands("read-only-git", [], undefined, ["status"]),
      hardSwitches: {
        runInstalls: { kind: "consult", person: "Devops" },
        publishOutsideThePipeline: { kind: "never" },
      },
    });

    expect(record).toContain(
      `## The Task\n\nRename a device, in the Project Admin panel.\n\n${WHO_ASKED}\n\n## What the user wants`,
    );
  });

  it("names the user who paused or stopped the Stage it resumes", () => {
    const stage = { key: "implement", name: "Implement", brief: "Build it." };
    const ben = { userId: "u-2", name: "Ben Ito" };

    expect(agentStageWork(stage, { held: { by: "pause", byUser: ben } })).toContain(
      "## Paused by the user Ben Ito\n\nThe user Ben Ito paused this Stage",
    );
    expect(agentStageWork(stage, { held: { by: "stop", byUser: ben } })).toContain(
      "## Stopped by the user Ben Ito\n\nThe user Ben Ito stopped this Stage",
    );
  });
});

function anAgentStage(key: string): AgentStage {
  return {
    kind: "agent",
    key,
    name: key,
    optional: false,
    role: "developer",
    brief: "Do it.",
    session: "continue",
    budget: 250_000,
  };
}

const implement = anAgentStage("implement");
const review = anAgentStage("review");
const lint: Stage = { kind: "script", key: "lint", name: "Lint", optional: false, command: "lint" };
const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};
const branchOnly: Stage = { ...publish, key: "try-out", publishTarget: "branch-only" };
const resolve = anAgentStage(RESOLVE_KEY);

function pipelineOf(stages: readonly Stage[]): StagePipeline {
  return { stages, commands: [], roleTitle: () => "Developer" };
}

const COMMIT_MESSAGE = {
  text: "Rename a device\n\nAdds a rename dialog.",
  written: true,
  landsOn: "main",
};

describe("an Agent Stage's Brief and the Task's commit message", () => {
  it("shows the commit message, and says when it is the default", () => {
    const record = (commitMessage: BriefTask["commitMessage"]) =>
      agentStageRecord({
        task: { ...task, commitMessage },
        earlier: [],
        diffSummary: undefined,
        commands: allowedCommands("read-only-git", [], undefined, ["status"]),
        hardSwitches: {
          runInstalls: { kind: "consult", person: "Devops" },
          publishOutsideThePipeline: { kind: "never" },
        },
      });

    expect(record({ text: "Rename a device\n\nAdds a rename dialog.", written: true })).toContain(
      "## The commit message\n\nPublish lands the Task as one commit with this message:\n\n```\nRename a device\n\nAdds a rename dialog.\n```\n\nUpdate it with write_commit_message",
    );
    expect(record({ text: "Rename a device", written: false })).toContain(
      "None is written yet, so Publish lands the Task as one commit with the default",
    );
  });

  it("tells only the last Agent Stage before a Publish to recheck it against the whole diff", () => {
    const pipeline = pipelineOf([implement, review, lint, publish]);

    const reviewWork = agentStageWork(review, { pipeline, commitMessage: COMMIT_MESSAGE });
    const implementWork = agentStageWork(implement, { pipeline, commitMessage: COMMIT_MESSAGE });

    expect(reviewWork).toContain("## Recheck the commit message");
    expect(reviewWork).toContain("`git diff main...HEAD`");
    expect(reviewWork).toContain("Rename a device\n\nAdds a rename dialog.");
    expect(implementWork).not.toContain("## Recheck the commit message");
  });
});

describe("isLastAgentStageBeforePublish", () => {
  it("is the last Agent Stage with a Publish after it, Script Stages between them", () => {
    const stages = [implement, review, lint, publish];

    expect(isLastAgentStageBeforePublish(review, stages)).toBe(true);
    expect(isLastAgentStageBeforePublish(implement, stages)).toBe(false);
  });

  it("isn't one before a branch-only Publish alone", () => {
    expect(isLastAgentStageBeforePublish(review, [implement, review, branchOnly])).toBe(false);
    expect(isLastAgentStageBeforePublish(review, [review, branchOnly, publish])).toBe(true);
  });

  it("passes over Resolve, which is never it", () => {
    const stages = [implement, review, resolve, lint, publish];

    expect(isLastAgentStageBeforePublish(review, stages)).toBe(true);
    expect(isLastAgentStageBeforePublish(resolve, stages)).toBe(false);
  });

  it("isn't one with no Publish after it", () => {
    expect(isLastAgentStageBeforePublish(review, [implement, review, lint])).toBe(false);
  });
});
