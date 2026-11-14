import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskPaused, TaskResumed, TaskStateChanged, TaskStopped } from "../../work/index.js";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { implement, review } from "../stage-interpreter-stop.fixtures.js";

let pipelines: PipelinesApplication;

/** The users whose Stop and Pause hold the runs, as Work's events name them. */
const BEN_ITO = { userId: "00000000-0000-4000-8000-0000000005e2", name: "Ben Ito" };
const ANN_LEE = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };

afterEach(async () => {
  await pipelines.app.close();
});

/** Ben Ito's Stop, as Work announces it once the Task is Paused. */
async function stop(taskId: string): Promise<void> {
  const { state } = await pipelines.tasks.read(taskId);
  pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
  await pipelines.app
    .get(EventBus)
    .publish(new TaskStopped(taskId, state as "in-progress", BEN_ITO));
}

/** Ann Lee's Pause, as Work announces it once the Task is Paused. */
async function pause(taskId: string): Promise<void> {
  const { state } = await pipelines.tasks.read(taskId);
  pipelines.tasks.put(taskId, { state: "paused", pipelineId: "for-tests" });
  await pipelines.app
    .get(EventBus)
    .publish(new TaskPaused(taskId, state as "in-progress", "user", undefined, ANN_LEE));
}

/** The user's Drop of the Task, or of its Initiative, as Work announces it once it is Dropped. */
async function drop(taskId: string): Promise<void> {
  const { state } = await pipelines.tasks.read(taskId);
  pipelines.tasks.put(taskId, { state: "dropped", pipelineId: "for-tests" });
  await pipelines.app
    .get(EventBus)
    .publish(new TaskStateChanged(taskId, state as "in-progress", "dropped"));
}

/** The user's Resume, as Work announces it, waiting for the walk it starts. */
async function resume(taskId: string): Promise<void> {
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

/** Runs `action` once, as the first Stage's first turn runs. */
function whileTheFirstTurnRuns(taskId: string, action: (taskId: string) => Promise<void>): void {
  pipelines.stageThreads.whileTurnRuns = () => {
    pipelines.stageThreads.whileTurnRuns = undefined;
    void action(taskId);
  };
}

async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}

describe("Stop", () => {
  it("interrupts the running turn now, discards the Stage's uncommitted edits and holds the Task, naming who stopped it", async () => {
    pipelines = await startPipelinesApplication([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts", "src/dialog.test.ts"]);
    whileTheFirstTurnRuns(taskId, stop);

    await walkStages(pipelines, [implement, review], taskId);

    const [run, ...more] = await runsOf(pipelines, taskId);
    const error =
      "Stopped by the user Ben Ito. The Office discarded the Stage's uncommitted edits to 2 files.";
    expect(run?.outcome).toEqual({
      status: "failed",
      error,
      interrupted: "stop",
      heldByUser: BEN_ITO,
    });
    expect(run).toMatchObject({ heldBy: "stop", heldByUser: BEN_ITO });
    expect(run?.tokens.output).toBe(40);
    expect(run?.headCommit).toBe(PLANNED_COMMIT);
    expect(more).toEqual([]);
    expect(pipelines.stageThreads.interrupted).toEqual([run?.threadId]);
    // No correction is asked of an interrupted turn, and nothing is committed or asked.
    expect(pipelines.stageThreads.sent).toEqual([]);
    expect(pipelines.stageThreads.ended).toEqual([
      {
        threadId: run?.threadId,
        handoverNote: undefined,
        closing: { kind: "held", heldBy: "stop", text: error },
      },
    ]);
    expect(pipelines.git.discarded).toEqual([
      { taskId, paths: ["src/dialog.ts", "src/dialog.test.ts"] },
    ]);
    expect(pipelines.git.commits).toEqual([]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
  });
});

describe("Drop", () => {
  it("stops a started Task's running turn now, as Stop does, and the walk goes on with no Stage", async () => {
    pipelines = await startPipelinesApplication([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    whileTheFirstTurnRuns(taskId, drop);

    await walkStages(pipelines, [implement, review], taskId);

    const [run, ...more] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toMatchObject({ status: "failed", interrupted: "stop" });
    expect(more).toEqual([]);
    expect(pipelines.stageThreads.interrupted).toEqual([run?.threadId]);
    expect(pipelines.stageThreads.requests).toHaveLength(1);
    expect((await pipelines.tasks.read(taskId)).state).toBe("dropped");
  });
});

describe("Pause", () => {
  it("holds the Stage once the Agent's turn ends, naming who paused it, committing nothing, and Resume goes on with it through the Context policy", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
      anAgentSession(aDoneResult()),
    ]);
    const taskId = randomUUID();
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    whileTheFirstTurnRuns(taskId, pause);

    await walkStages(pipelines, [implement, review], taskId);

    const [paused, ...more] = await runsOf(pipelines, taskId);
    const error =
      "Paused by the user Ann Lee. The Stage's uncommitted edits stay in the worktree for it to go on with.";
    expect(paused?.outcome).toEqual({
      status: "failed",
      error,
      interrupted: "pause",
      heldByUser: ANN_LEE,
    });
    expect(paused?.headCommit).toBe(PLANNED_COMMIT);
    expect(more).toEqual([]);
    expect(pipelines.stageThreads.interrupted).toEqual([]);
    expect(pipelines.stageThreads.sessionsEnded).toEqual([paused?.threadId]);
    expect(pipelines.git.commits).toEqual([]);
    expect(pipelines.git.discarded).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    await resume(taskId);

    const again = pipelines.stageThreads.requests[1];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(paused?.threadId);
    expect(again?.carryMessagesSince).toEqual(paused?.startedAt);
    expect(again?.work).toContain(
      "## Paused by the user Ann Lee\n\nThe user Ann Lee paused this Stage",
    );
    expect(await statusesOf(taskId)).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
    expect(pipelines.git.commits).toHaveLength(2);
    expect((await pipelines.tasks.read(taskId)).state).toBe("done");
  });
});
