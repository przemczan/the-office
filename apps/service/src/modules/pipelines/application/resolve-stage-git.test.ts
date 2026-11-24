import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskPaused, TaskResumed } from "../../work/index.js";
import { implement } from "../agent-stage-runner.fixtures.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";

let pipelines: PipelinesApplication;

afterEach(async () => {
  await pipelines.app.close();
});

const ANN_LEE = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
const MERGED = "d".repeat(40);

const resolve = anAgentStage("resolve", {
  name: "Resolve",
  brief: "Keep what both sides meant.",
  mergeBaseFirst: true,
});

/** Ann Lee's Pause, as Work announces it once the Task is Paused. */
async function pause(taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
  await pipelines.app
    .get(EventBus)
    .publish(new TaskPaused(taskId, "in-progress", "user", undefined, ANN_LEE));
}

/** The user's Resume, as Work announces it, waiting for the walk it starts. */
async function resume(taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

/** Pauses the Task as Resolve's first turn runs, the Implement's being the first of all. */
function pausedInResolvesTurn(taskId: string): void {
  let turns = 0;
  pipelines.stageThreads.whileTurnRuns = () => {
    turns += 1;
    if (turns !== 2) return;
    pipelines.stageThreads.whileTurnRuns = undefined;
    void pause(taskId);
  };
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

describe("A Stage with Merge the base first, held and resumed", () => {
  it("goes on over its committed merge and the Agent's kept edits, merging the base nothing again", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Fixed the rename after the merge.")),
    ]);
    const taskId = randomUUID();
    pipelines.publishing.resolveStarts.push({
      kind: "merged",
      base: { remote: "origin", branch: "main" },
      commit: MERGED,
    });
    pausedInResolvesTurn(taskId);

    await walkStages(pipelines, [implement, resolve], taskId);

    const [, paused] = await runsOf(pipelines, taskId);
    expect(paused?.outcome).toMatchObject({ status: "failed", interrupted: "pause" });
    expect(paused?.headCommit).toBe(MERGED);

    await resume(taskId);

    expect(pipelines.publishing.resolveCalls).toEqual([{ call: "start", taskId }]);
    const again = pipelines.stageThreads.requests.at(-1)?.work;
    expect(again).toContain("## Paused by the user Ann Lee");
    expect(again).toContain(
      "it came in cleanly, with no conflict: the merge is committed already.",
    );
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "done"],
      ["resolve", "failed"],
      ["resolve", "done"],
    ]);
  });

  it("takes the merge left in progress as it is, for its Agent to go on resolving", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult("Kept both renames.")),
    ]);
    const taskId = randomUUID();
    const conflicted = {
      kind: "conflicted",
      base: { remote: "origin", branch: "main" },
      conflictedFiles: ["src/index.ts"],
    } as const;
    pipelines.publishing.resolveStarts.push(conflicted, conflicted);
    pausedInResolvesTurn(taskId);

    await walkStages(pipelines, [implement, resolve], taskId);
    await resume(taskId);

    expect(pipelines.publishing.resolveCalls).toEqual([
      { call: "start", taskId },
      { call: "start", taskId },
      { call: "finish", taskId },
    ]);
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "done"],
      ["resolve", "failed"],
      ["resolve", "done"],
    ]);
  });
});
