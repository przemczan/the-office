import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { builtInPipelines, RESOLVE_CONFLICTS_PIPELINE } from "../domain/built-in-pipelines.js";
import {
  aDoneResult,
  anAgentSession,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import {
  aCommandRun,
  aTaskRecord,
  PLANNED_COMMIT,
  RESOLVED_COMMIT,
} from "../ports/pipelines-ports.fixtures.js";
import { StageBranchUpdate } from "./stage-branch-update.js";

const SESSION = "the-resolving-session";
const PULL_REQUEST_BRANCH = "office/0f6c1d2e-original";
const stages = builtInPipelines.find(({ id }) => id === RESOLVE_CONFLICTS_PIPELINE)!.stages;

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

/** A Conflict resolution Task's record: its worktree holds the pull request's own branch. */
function aConflictResolutionRecord() {
  const record = aTaskRecord();
  return aTaskRecord({ worktree: { ...record.worktree, branch: PULL_REQUEST_BRANCH } });
}

/**
 * The Agent of every Resolve conflicts Stage calls update_branch in its turn, whose merge of the
 * base conflicts in `src/devices.ts` the first time and is left in the worktree.
 */
function agentUpdatesTheBranch(taskId: string): string[] {
  pipelines.records.put(taskId, aConflictResolutionRecord());
  pipelines.git.move(taskId, { commit: PLANNED_COMMIT, branch: PULL_REQUEST_BRANCH });
  pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
  pipelines.git.branchUpdates.set(taskId, {
    kind: "conflicted",
    conflictedFiles: ["src/devices.ts"],
  });
  const answers: string[] = [];
  pipelines.stageThreads.whileWorking = async () => {
    pipelines.git.merging.add(taskId);
    const answer = await pipelines.app.get(StageBranchUpdate, { strict: false }).inSession(SESSION);
    answers.push(answer.text);
  };
  return answers;
}

const aFailedResult = {
  status: "failed",
  summary: "Couldn't tell which of the two renames wins.",
  failureReason: "Both sides renamed the device field differently.",
  handoverNote: "src/devices.ts still holds its conflict markers.",
};

describe("The Resolve conflicts Pipeline", () => {
  it("merges the base in on the pull request's branch, commits the resolved merge, tests and pushes the branch only", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult("Kept both."))]);
    const taskId = randomUUID();
    const answers = agentUpdatesTheBranch(taskId);
    pipelines.publishing.publications.push({
      kind: "branch-pushed",
      branch: PULL_REQUEST_BRANCH,
      remote: "origin",
    });

    await walkStages(pipelines, stages, taskId);

    expect(answers[0]).toContain("- src/devices.ts");
    expect(pipelines.stageThreads.requests[0]?.work).toContain("never a rebase");
    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["resolve-conflicts", "done"],
      ["test", "done"],
      ["publish", "done"],
    ]);
    // The Stage's end committed the merge, as one merge commit: no Stage commit over it.
    expect(pipelines.publishing.resolveCalls).toEqual([{ call: "finish", taskId }]);
    expect(runs[0]?.headCommit).toBe(RESOLVED_COMMIT);
    expect(pipelines.git.commits).toEqual([]);
    expect(pipelines.commands.ran.map(({ key }) => key)).toEqual(["test"]);
    expect(pipelines.publishing.published.map(({ target }) => target)).toEqual(["branch-only"]);
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
  });

  it("goes back to the Agent when Test fails, and asks the user once its two rounds are used", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    agentUpdatesTheBranch(taskId);
    for (let round = 0; round < 3; round += 1) {
      pipelines.commands.commandRuns.push([aCommandRun("npm test", "failed", "1 failing")]);
    }

    await walkStages(pipelines, stages, taskId);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status])).toEqual([
      ["resolve-conflicts", "done"],
      ["test", "failed"],
      ["resolve-conflicts", "done"],
      ["test", "failed"],
      ["resolve-conflicts", "done"],
      ["test", "failed"],
    ]);
    expect(pipelines.decisions.on(taskId)).toHaveLength(1);
    expect(pipelines.publishing.published).toEqual([]);
  });

  it("asks the user when the Agent can't finish, then gives the merge back and removes the worktree once dropped", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aFailedResult)]);
    const taskId = randomUUID();
    agentUpdatesTheBranch(taskId);
    let callsBeforeRemoval: string[] | undefined;
    pipelines.git.observe = (gitCall) => {
      if (gitCall === "removeWorktree") {
        callsBeforeRemoval = pipelines.publishing.resolveCalls.map(({ call }) => call);
      }
    };

    await walkStages(pipelines, stages, taskId);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey }) => stageKey)).toEqual(["resolve-conflicts"]);
    expect(runs[0]?.outcome).toMatchObject({
      status: "failed",
      error: aFailedResult.failureReason,
      handoverNote: aFailedResult.handoverNote,
    });
    expect(pipelines.decisions.on(taskId)).toHaveLength(1);
    // The merge stays in the worktree, uncommitted, for the user to see.
    expect(pipelines.publishing.resolveCalls).toEqual([]);
    expect(pipelines.git.removedWorktrees).toEqual([]);

    pipelines.tasks.put(taskId, {
      state: "in-progress",
      pipelineId: RESOLVE_CONFLICTS_PIPELINE,
      madeFor: "resolve-conflicts",
    });
    await pipelines.tasks.drop(taskId, { kind: "user", user: null });

    // The merge is aborted first, so the branch stays as its last commit, then the worktree goes.
    expect(callsBeforeRemoval).toEqual(["abandon"]);
    expect(pipelines.git.removedWorktrees).toEqual([taskId]);
    expect(pipelines.git.commits).toEqual([]);
  });

  it("leaves the worktree of an ordinary dropped Task, giving back only its merge", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aFailedResult)]);
    const taskId = randomUUID();
    agentUpdatesTheBranch(taskId);
    await walkStages(pipelines, stages, taskId);

    await pipelines.tasks.drop(taskId, { kind: "user", user: null });

    expect(pipelines.publishing.resolveCalls).toEqual([{ call: "abandon", taskId }]);
    expect(pipelines.git.removedWorktrees).toEqual([]);
  });
});
