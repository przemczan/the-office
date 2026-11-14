import { describe, expect, it } from "vitest";
import { agentStageRecord, agentStageWork, type BriefTask } from "./agent-stage-brief.js";
import { allowedCommands } from "./allowed-commands.js";

const WHO_ASKED =
  "## Who asked\n\nThe Task was created by the user Ann Lee and started by the queue, as its turn came (queued by the user Ben Ito).";

const task: BriefTask = {
  title: "Rename a device",
  descriptionSection: "## What the user wants, in their own words\n\nLet me name my devices.",
  plan: "",
  definitionOfDone: [],
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
