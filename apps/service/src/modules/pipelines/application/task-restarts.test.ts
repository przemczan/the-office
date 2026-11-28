import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  LEFT_THE_WORKSTATION,
  TaskPaused,
  TaskResumed,
  TaskStartOvers,
  type StartOverWork,
} from "../../work/index.js";
import { RestartRefused } from "../domain/restart-refused.js";
import type { Stage } from "../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { TaskRestarts } from "./task-restarts.js";
import { TaskStagesService } from "./task-stages-service.js";

let pipelines: PipelinesApplication;

const ANN_LEE = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
const FEEDBACK = "Use the existing dialog hook.";

const implement = anAgentStage("implement", { name: "Implement" });
const review = anAgentStage("review", { name: "Review" });
const polish = anAgentStage("polish", { name: "Polish" });
const ship: Stage = {
  kind: "script",
  key: "ship",
  name: "Ship",
  optional: false,
  command: "build",
};

const agentDone = (): ReturnType<typeof anAgentSession> => anAgentSession(aDoneResult());

afterEach(async () => {
  await pipelines.app.close();
});

/** Ann Lee's Pause, as Work announces it once the Task is Paused. */
async function pause(taskId: string): Promise<void> {
  const { state } = await pipelines.tasks.read(taskId);
  pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
  await pipelines.app
    .get(EventBus)
    .publish(new TaskPaused(taskId, state as "in-progress", "user", undefined, ANN_LEE));
}

/** Pauses the Task as the `turn`th Agent turn of the walk runs, from 1. */
function pausingAtTurn(taskId: string, turn: number): void {
  let turns = 0;
  pipelines.stageThreads.whileTurnRuns = () => {
    turns += 1;
    if (turns !== turn) return;
    pipelines.stageThreads.whileTurnRuns = undefined;
    void pause(taskId);
  };
}

async function walked(taskId: string): Promise<void> {
  await pipelines.app.get(StageInterpreter).walked(taskId);
}

async function restart(taskId: string, stageKey: string, feedback?: string): Promise<void> {
  await pipelines.app.get(TaskRestarts).restart(taskId, { stageKey, feedback }, ANN_LEE);
  await walked(taskId);
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

async function statesOf(taskId: string): Promise<[string, string][]> {
  const progress = await pipelines.app.get(TaskStagesService).progress(taskId);
  return (progress?.stages ?? []).map(({ stage, state }) => [stage.key, state]);
}

describe("Restart from…", () => {
  it("runs a later Agent Stage next with the feedback, its held run's edits discarded and the Stages jumped over Skipped", async () => {
    pipelines = await startPipelinesApplication([agentDone(), agentDone()]);
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    pausingAtTurn(taskId, 1);
    await walkStages(pipelines, [implement, review, polish, ship], taskId);
    expect(await statusesOf(taskId)).toEqual([["implement", "failed"]]);

    await restart(taskId, "polish", `  ${FEEDBACK}\n`);

    expect(pipelines.tasks.restarts).toEqual([{ taskId, stageName: "Polish", by: ANN_LEE }]);
    expect(pipelines.git.discarded).toEqual([{ taskId, paths: ["src/dialog.ts"] }]);
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "failed"],
      ["polish", "done"],
      ["ship", "done"],
    ]);
    const [held, polished] = await runsOf(pipelines, taskId);
    expect(held?.restart).toEqual({ stageKey: "polish", feedback: FEEDBACK, byUser: ANN_LEE });
    expect(held?.headCommit).toBe(PLANNED_COMMIT);
    expect(polished?.restarted).toEqual({ feedback: FEEDBACK, byUser: ANN_LEE });
    const request = pipelines.stageThreads.requests[1];
    expect(request?.work).toContain("## Restarted from this Stage");
    expect(request?.work).toContain(`Their feedback:\n\n${FEEDBACK}`);
    expect(request?.work).not.toContain("## Paused by the user");
    expect(await statesOf(taskId)).toEqual([
      ["implement", "stopped"],
      ["review", "skipped"],
      ["polish", "done"],
      ["ship", "done"],
    ]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });

  it("runs an earlier Stage next and goes on from it by its routes, using no route's times", async () => {
    pipelines = await startPipelinesApplication([
      agentDone(),
      agentDone(),
      agentDone(),
      agentDone(),
    ]);
    const taskId = randomUUID();
    pausingAtTurn(taskId, 2);
    await walkStages(pipelines, [implement, review], taskId);
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "done"],
      ["review", "failed"],
    ]);

    await restart(taskId, "implement");

    expect(await statusesOf(taskId)).toEqual([
      ["implement", "done"],
      ["review", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
    const runs = await runsOf(pipelines, taskId);
    expect(runs[2]?.restarted).toEqual({ feedback: undefined, byUser: ANN_LEE });
    expect(runs[2]?.carriedFailure).toBeUndefined();
    const again = pipelines.stageThreads.requests[2];
    expect(again?.work).toContain("## Restarted from this Stage");
    expect(again?.work).not.toContain("Their feedback");
  });

  it("runs a Script Stage, keeping the feedback on its run", async () => {
    pipelines = await startPipelinesApplication([agentDone()]);
    const taskId = randomUUID();
    pausingAtTurn(taskId, 1);
    await walkStages(pipelines, [implement, ship], taskId);

    await restart(taskId, "ship", FEEDBACK);

    const runs = await runsOf(pipelines, taskId);
    expect(runs.map(({ stageKey }) => stageKey)).toEqual(["implement", "ship"]);
    expect(runs[1]?.restarted).toEqual({ feedback: FEEDBACK, byUser: ANN_LEE });
    expect(pipelines.stageThreads.requests).toHaveLength(1);
  });

  it("refuses with every reason: a Task not held by the user, or a Stage not of its Pipeline", async () => {
    pipelines = await startPipelinesApplication([agentDone()]);
    const taskId = randomUUID();
    pausingAtTurn(taskId, 1);
    await walkStages(pipelines, [implement, ship], taskId);
    pipelines.tasks.restartRefusals.set(taskId, ["The fire alarm holds it."]);

    const refused = pipelines.app
      .get(TaskRestarts)
      .restart(taskId, { stageKey: "deploy", feedback: undefined }, ANN_LEE);
    await expect(refused).rejects.toThrow(RestartRefused);
    await expect(refused).rejects.toMatchObject({
      reasons: ["The fire alarm holds it.", `"deploy" isn't a Stage of the Task's Pipeline.`],
    });
    expect((await runsOf(pipelines, taskId))[0]?.restart).toBeUndefined();
    expect(pipelines.tasks.restarts).toEqual([]);
  });
});

function startOvers(): StartOverWork {
  return pipelines.app.get(TaskStartOvers).registered;
}

/** Work's Start after a Start over: the Task In progress again, walked. */
async function startAgain(taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await walked(taskId);
}

describe("Start over", () => {
  it("resets the branch to the base, keeping the old head, and walks from the first Stage in fresh sessions", async () => {
    pipelines = await startPipelinesApplication([
      agentDone(),
      agentDone(),
      agentDone(),
      agentDone(),
    ]);
    const taskId = randomUUID();
    pausingAtTurn(taskId, 2);
    await walkStages(pipelines, [implement, review], taskId);
    const head = (await runsOf(pipelines, taskId))[0]?.headCommit;
    expect(await startOvers().hadStarted(taskId)).toBe(true);
    expect(await startOvers().resetTo(taskId)).toBe("main");

    const started = await startOvers().startOver(taskId, { resetBranch: true, by: ANN_LEE });

    const keptRef = `refs/office/started-over/${taskId}/1`;
    expect(started).toEqual({ resetTo: "main", keptRef });
    expect(pipelines.git.keptRefs.get(keptRef)).toBe(head);
    const last = (await runsOf(pipelines, taskId)).at(-1);
    expect(last?.startedOver).toMatchObject({
      number: 1,
      byUser: ANN_LEE,
      resetTo: "main",
      keptRef,
    });
    expect(await startOvers().hadStarted(taskId)).toBe(false);
    expect(await statesOf(taskId)).toEqual([
      ["implement", "pending"],
      ["review", "pending"],
    ]);

    await startAgain(taskId);

    expect(await statusesOf(taskId)).toEqual([
      ["implement", "done"],
      ["review", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
    expect(pipelines.stageThreads.requests[2]?.previousThreadId).toBeUndefined();
    expect(pipelines.stageThreads.requests[2]?.declared).toBe("fresh");
    const progress = await pipelines.app.get(TaskStagesService).progress(taskId);
    const implementRuns = progress?.stages[0];
    expect(implementRuns?.runs.map(({ number }) => number)).toEqual([1, 3]);
    expect([...(implementRuns?.earlierStart ?? [])]).toEqual([
      (await runsOf(pipelines, taskId))[0]?.id,
    ]);
  });

  it("keeps the branch as it is without a reset", async () => {
    pipelines = await startPipelinesApplication([agentDone(), agentDone()]);
    const taskId = randomUUID();
    pausingAtTurn(taskId, 1);
    await walkStages(pipelines, [implement, review], taskId);

    expect(await startOvers().startOver(taskId, { resetBranch: false, by: ANN_LEE })).toEqual({
      resetTo: undefined,
      keptRef: undefined,
    });
    expect(pipelines.git.keptRefs.size).toBe(0);
    const kept = (await runsOf(pipelines, taskId))[0]?.startedOver;
    expect(kept?.number).toBe(1);
    expect(kept?.resetTo).toBeUndefined();
    expect(kept?.keptRef).toBeUndefined();
  });

  it("keeps the branch of a Task a Publish shipped, starting its work over onto it", async () => {
    pipelines = await startPipelinesApplication([agentDone()]);
    const taskId = randomUUID();
    pausingAtTurn(taskId, 1);
    await walkStages(pipelines, [implement, ship], taskId);
    const [held] = await runsOf(pipelines, taskId);
    if (!held) throw new Error("No run.");
    await pipelines.app.get(StageRunRepository).savePublished(held.id, {
      kind: "pull-request-opened",
      branch: "office/task",
      commit: PLANNED_COMMIT,
      pullRequestUrl: "https://github.com/acme/app/pull/7",
    });

    expect(await startOvers().refusals(taskId)).toEqual([]);
    expect(await startOvers().branchResetRefusals(taskId)).toEqual([LEFT_THE_WORKSTATION]);
    await expect(
      startOvers().startOver(taskId, { resetBranch: true, by: ANN_LEE }),
    ).rejects.toThrow(LEFT_THE_WORKSTATION);
    expect(await startOvers().startOver(taskId, { resetBranch: false, by: ANN_LEE })).toEqual({
      resetTo: undefined,
      keptRef: undefined,
    });
    expect(pipelines.git.keptRefs.size).toBe(0);
  });
});
