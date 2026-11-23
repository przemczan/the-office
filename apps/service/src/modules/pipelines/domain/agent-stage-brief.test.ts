import { describe, expect, it } from "vitest";
import {
  AGENT_STAGE_INSTRUCTIONS,
  agentStageRecord,
  agentStageWork,
  isLastAgentStageBeforePublish,
  type BriefTask,
  type StagePipeline,
} from "./agent-stage-brief.js";
import { allowedCommands } from "./allowed-commands.js";
import { asFlow, pipelineOrder } from "./flow.js";
import { RESOLVE_KEY } from "./publish-stages.js";
import { keptPublishStage, publishStage } from "./stage.fixtures.js";
import type { AgentStage, Stage } from "./stage.js";
import { defaultPromptTexts } from "../../prompt-templates/index.js";
import { PIPELINES_PROMPT_TEMPLATES } from "./pipelines-prompt-templates.js";

const prompts = defaultPromptTexts(PIPELINES_PROMPT_TEMPLATES);

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
  connectedDeviceLines: [],
  whoAskedSection: WHO_ASKED,
  projectName: "Admin panel",
  baseBranch: "main",
  worktree: { path: "/worktrees/task", branch: "office/task", screenshotsFolder: ".shots" },
};

function briefWithDevices(connectedDeviceLines: readonly string[]): string {
  return agentStageRecord(prompts, {
    task: { ...task, connectedDeviceLines },
    earlier: [],
    diffSummary: undefined,
    commands: allowedCommands(prompts, "read-only-git", [], undefined, ["status"]),
    hardSwitches: {
      runInstalls: { kind: "consult", person: "Devops" },
      publishOutsideThePipeline: { kind: "never" },
    },
  });
}

describe("an Agent Stage's Brief names the Connected devices", () => {
  const brief = briefWithDevices;

  it("lists the devices connected as the Stage starts", () => {
    expect(brief(["Android phone over USB «Pixel 8»: Connected, at 127.0.0.1:41234"])).toContain(
      "## Connected devices\n\n",
    );
    expect(brief(["Android phone over USB «Pixel 8»: Connected, at 127.0.0.1:41234"])).toContain(
      "Android phone over USB «Pixel 8»: Connected, at 127.0.0.1:41234\n",
    );
  });

  it("leaves the section out when none is connected", () => {
    expect(brief([])).not.toContain("Connected devices");
  });
});

describe("an Agent Stage's Brief says which user asked", () => {
  it("names who created the Task and who started or queued it, right after the Task", () => {
    const record = agentStageRecord(prompts, {
      task,
      earlier: [],
      diffSummary: undefined,
      commands: allowedCommands(prompts, "read-only-git", [], undefined, ["status"]),
      hardSwitches: {
        runInstalls: { kind: "consult", person: "Devops" },
        publishOutsideThePipeline: { kind: "never" },
      },
    });

    expect(record).toContain(
      `## The Task\n\nRename a device, in the Project Admin panel.\n\n${WHO_ASKED}\n\n## What the user wants`,
    );
  });

  it("marks the Definition of Done statements earlier Stages reported met, counting every report", () => {
    const record = agentStageRecord(prompts, {
      task: { ...task, definitionOfDone: ["The name shows", "The name persists", "It runs live"] },
      earlier: [
        {
          stageName: "Implement",
          kind: "agent",
          outcome: { status: "done", summary: "Built.", definitionOfDoneMet: [1, 2] },
        },
        {
          stageName: "Review",
          kind: "agent",
          outcome: { status: "done", summary: "Reviewed.", definitionOfDoneMet: [] },
        },
      ],
      diffSummary: undefined,
      commands: allowedCommands(prompts, "read-only-git", [], undefined, ["status"]),
      hardSwitches: {
        runInstalls: { kind: "consult", person: "Devops" },
        publishOutsideThePipeline: { kind: "never" },
      },
    });

    expect(record).toContain(
      "## The Definition of Done\n\n1. The name shows (Reported met so far)\n2. The name persists (Reported met so far)\n3. It runs live\n",
    );
  });

  it("tells the Agent a statement reported met stays met unless it lists it as no longer met", () => {
    expect(AGENT_STAGE_INSTRUCTIONS).toContain(
      "A statement reported met, by you or an earlier Stage, stays met: the Brief marks those Reported met so far. One your work no longer meets, such as a regression you found, you list as no longer met, which takes it back.",
    );
  });

  it("names the user who paused or stopped the Stage it resumes", () => {
    const stage = { key: "implement", name: "Implement", brief: "Build it." };
    const ben = { userId: "u-2", name: "Ben Ito" };

    expect(agentStageWork(prompts, stage, { held: { by: "pause", byUser: ben } })).toContain(
      "## Paused by the user Ben Ito\n\nThe user Ben Ito paused this Stage",
    );
    expect(agentStageWork(prompts, stage, { held: { by: "stop", byUser: ben } })).toContain(
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
const publish: Stage = publishStage();
const branchOnly: Stage = publishStage({ key: "try-out", publishTarget: "branch-only" });

function pipelineOf(stages: readonly Stage[]): StagePipeline {
  return { stages, commands: [], roleTitle: () => "Developer" };
}

const COMMIT_MESSAGE = {
  text: "Rename a device\n\nAdds a rename dialog.",
  written: true,
  landsOn: "main",
  changesFrom: ["refs/remotes/origin/main"],
};

/** The Task's record in an Agent Stage's Brief, with the given commit message. */
function recordWithCommitMessage(commitMessage: BriefTask["commitMessage"]): string {
  return agentStageRecord(prompts, {
    task: { ...task, commitMessage },
    earlier: [],
    diffSummary: undefined,
    commands: allowedCommands(prompts, "read-only-git", [], undefined, ["status"]),
    hardSwitches: {
      runInstalls: { kind: "consult", person: "Devops" },
      publishOutsideThePipeline: { kind: "never" },
    },
  });
}

describe("an Agent Stage's Brief and the Task's commit message", () => {
  it("shows the commit message, and says when it is the default", () => {
    expect(
      recordWithCommitMessage({ text: "Rename a device\n\nAdds a rename dialog.", written: true }),
    ).toContain(
      "## The commit message\n\nPublish lands the Task as one commit with this message:\n\n```\nRename a device\n\nAdds a rename dialog.\n```\n\nUpdate it with write_commit_message",
    );
    expect(recordWithCommitMessage({ text: "Rename a device", written: false })).toContain(
      "None is written yet, so Publish lands the Task as one commit with the default",
    );
  });

  it("tells only the last Agent Stage before a Publish to recheck it against the whole diff", () => {
    const pipeline = pipelineOf([implement, review, lint, publish]);

    const reviewWork = agentStageWork(prompts, review, { pipeline, commitMessage: COMMIT_MESSAGE });
    const implementWork = agentStageWork(prompts, implement, {
      pipeline,
      commitMessage: COMMIT_MESSAGE,
    });

    expect(reviewWork).toContain("## Recheck the commit message");
    expect(reviewWork).toContain("lands the Task on main as one commit");
    expect(reviewWork).toContain("`git diff origin/main...HEAD`");
    expect(reviewWork).toContain("Rename a device\n\nAdds a rename dialog.");
    expect(implementWork).not.toContain("## Recheck the commit message");
  });

  it("reads a Task of an Initiative's own commits, without what its two bases brought in", () => {
    const work = agentStageWork(prompts, review, {
      pipeline: pipelineOf([implement, review, publish]),
      commitMessage: {
        ...COMMIT_MESSAGE,
        landsOn: "initiative/sign-in",
        changesFrom: ["4f2c9e1a", "refs/remotes/origin/main"],
      },
    });

    expect(work).toContain("lands the Task on initiative/sign-in as one commit");
    expect(work).toContain("`git log -p --no-merges HEAD --not 4f2c9e1a origin/main`");
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

  it("passes over the conflict chain's Resolve, which is never it", () => {
    const stages = pipelineOrder(asFlow([implement, review, lint, keptPublishStage()]));

    expect(stages.map(({ key }) => key)).toContain(RESOLVE_KEY);
    expect(isLastAgentStageBeforePublish(review, stages)).toBe(true);
    expect(isLastAgentStageBeforePublish({ key: RESOLVE_KEY }, stages)).toBe(false);
  });

  it("isn't one with no Publish after it", () => {
    expect(isLastAgentStageBeforePublish(review, [implement, review, lint])).toBe(false);
  });
});
