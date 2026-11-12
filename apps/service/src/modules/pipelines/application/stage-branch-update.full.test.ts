import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { aTaskRecord } from "../ports/pipelines-ports.fixtures.js";
import { StageBranchUpdate, type StageBranchUpdateAnswer } from "./stage-branch-update.js";

const SESSION = "the-stage's-session";
const implement = anAgentStage("implement", { name: "Implement" });
let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

/** Walks one Stage whose Agent calls the tool in its turn, and returns what it was answered. */
async function askedDuringTheStage(
  taskId: string,
  before: () => void = () => undefined,
  after: () => void = () => undefined,
): Promise<StageBranchUpdateAnswer> {
  pipelines.stageThreads.taskOfSession.set(SESSION, taskId);
  const tool = pipelines.app.get(StageBranchUpdate, { strict: false });
  let answer: StageBranchUpdateAnswer | undefined;
  pipelines.stageThreads.whileWorking = async () => {
    // The first Stage's own update has gone by: what follows is the Agent's ask.
    before();
    answer = await tool.inSession(SESSION);
    after();
  };
  await walkStages(pipelines, [implement], taskId);
  if (!answer) throw new Error("The Stage's turn didn't run.");
  return answer;
}

describe("StageBranchUpdate", () => {
  it("refuses a session on no running Stage", async () => {
    pipelines = await startPipelinesApplication();
    const tool = pipelines.app.get(StageBranchUpdate, { strict: false });

    await expect(tool.inSession("a chat's session")).resolves.toMatchObject({ isError: true });
  });

  it("commits the work so far, updates the branch and expects HEAD there at the Stage's end", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const updated = "d".repeat(40);

    const answer = await askedDuringTheStage(taskId, () => {
      pipelines.git.branchUpdates.set(taskId, { kind: "updated", commit: updated });
    });

    expect(answer.isError).toBe(false);
    expect(answer.text).toContain("is now up to date with main,");
    const [work, stageEnd] = pipelines.git.commits;
    expect(work?.message).toContain("Work before updating from");
    expect(stageEnd?.message).toContain("Implement:");
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome?.status).toBe("done");
    expect(run?.headCommit).toBe(stageEnd?.commit);
  });

  it("leaves a conflict for the Agent, and the Stage's end commits the merge", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();

    const answer = await askedDuringTheStage(taskId, () => {
      pipelines.git.branchUpdates.set(taskId, { kind: "conflicted", conflictedFiles: ["a.ts"] });
      pipelines.git.merging.add(taskId);
    });

    expect(answer.text).toContain("- a.ts");
    expect(answer.isError).toBe(false);
    expect(pipelines.publishing.resolveCalls).toEqual([{ call: "finish", taskId }]);
    expect(pipelines.git.commits).toEqual([]);
  });

  it("keeps HEAD at the clean merge of the Initiative's branch when the base then conflicts", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.records.put(taskId, aTaskRecord({ initiativeBranch: "initiative/usage-exports" }));

    const answer = await askedDuringTheStage(taskId, () => {
      pipelines.git.branchUpdates.set(taskId, {
        kind: "conflicted",
        conflictedFiles: ["a.ts"],
        from: "main",
        commit: "c".repeat(40),
      });
      pipelines.git.merging.add(taskId);
    });

    expect(answer.text).toContain("Merging main conflicts in these files");
    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome?.status).toBe("done");
    expect(pipelines.publishing.resolveCalls).toEqual([{ call: "finish", taskId }]);
  });

  it("names the Initiative's branch, then the base, as what the branch takes in", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.records.put(taskId, aTaskRecord({ initiativeBranch: "initiative/usage-exports" }));

    const answer = await askedDuringTheStage(taskId);

    expect(answer.text).toBe(
      "The Task's branch is already up to date with initiative/usage-exports, then main.",
    );
  });

  it("commits nothing over a merge already left in the worktree", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    pipelines.git.merging.add(taskId);
    pipelines.git.branchUpdates.set(taskId, { kind: "conflicted", conflictedFiles: ["a.ts"] });

    await askedDuringTheStage(taskId);

    expect(pipelines.git.commits).toEqual([]);
  });

  it("answers why git refused, as an error", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();

    const answer = await askedDuringTheStage(taskId, () => {
      pipelines.git.branchUpdates.set(taskId, { kind: "failed", error: "no network" });
    });

    expect(answer).toMatchObject({ isError: true });
    expect(answer.text).toContain("no network");
  });

  it("still fails a Stage that moved HEAD itself after updating", async () => {
    pipelines = await startPipelinesApplication([anAgentSession(aDoneResult())]);
    const taskId = randomUUID();
    const branch = aTaskRecord().worktree.branch;

    await askedDuringTheStage(
      taskId,
      () => undefined,
      () => {
        pipelines.git.move(taskId, { commit: "e".repeat(40), branch });
      },
    );

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toMatchObject({ status: "failed" });
  });
});
