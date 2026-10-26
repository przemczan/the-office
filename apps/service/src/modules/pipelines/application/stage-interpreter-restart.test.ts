import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionScript } from "../../engine/index.js";
import {
  AN_INTERRUPTED_SESSION,
  aDoneResult,
  anAgentSession,
  anAgentStage,
  answerLastDecision,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../pipelines-application.fixtures.js";
import type { Stage } from "../domain/stage.js";
import { interruptedOutcome } from "../domain/stage-interruption.js";
import { endStageRun, startStageRun } from "../domain/stage-run-changes.js";
import { PLANNED_COMMIT } from "../ports/pipelines-ports.fixtures.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";

const implement = anAgentStage("implement", { name: "Implement" });
const review = anAgentStage("review", { name: "Review & fix" });
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};

const RESTART_QUESTION = 'The Office restarted during "Implement". Run it again?';

const open = new Set<PipelinesApplication>();

afterEach(async () => {
  await Promise.all([...open].map(close));
});

async function start(scripts: readonly SessionScript[] = []): Promise<PipelinesApplication> {
  const pipelines = await startPipelinesApplication(scripts);
  open.add(pipelines);
  return pipelines;
}

/** Shuts the service down, as The Office stops. */
function close(pipelines: PipelinesApplication): Promise<void> {
  open.delete(pipelines);
  return pipelines.app.close();
}

/** The service starting with the Task as Work keeps it, waiting for the walk that may start. */
async function startUp(
  pipelines: PipelinesApplication,
  taskId: string,
  state: "in-progress" | "paused",
): Promise<void> {
  pipelines.tasks.put(taskId, { state, pipelineId: "for-tests" });
  const interpreter = pipelines.app.get(StageInterpreter, { strict: false });
  await interpreter.onApplicationBootstrap();
  await interpreter.walked(taskId);
}

/** A Task following `stages` whose first Stage's run is still running, as a crash leaves it. */
async function aRunLeftRunning(
  { app }: PipelinesApplication,
  stages: readonly Stage[],
): Promise<string> {
  const taskId = randomUUID();
  await app.get(TaskStagesRepository, { strict: false }).saveNew({
    taskId,
    pipelineId: "for-tests",
    stages,
    startedAt: new Date(),
    trace: undefined,
  });
  const { run } = startStageRun(
    { id: randomUUID(), taskId, stageKey: stages[0]?.key ?? "", carriedFailure: undefined },
    0,
    new Date(),
  );
  await app.get(StageRunRepository, { strict: false }).saveNew(run);
  return taskId;
}

function outcomesOf(pipelines: PipelinesApplication, taskId: string): Promise<unknown[]> {
  return runsOf(pipelines, taskId).then((runs) => runs.map(({ outcome }) => outcome));
}

describe("Shutting down during a Stage", () => {
  it("ends the running session at once, and at the next start asks whether to run the Stage again, which the user's words go with", async () => {
    const before = await start([AN_INTERRUPTED_SESSION]);
    const taskId = randomUUID();
    before.git.uncommitted.set(taskId, ["src/dialog.ts"]);
    let closed: Promise<void> | undefined;
    before.stageThreads.whileTurnRuns = () => {
      before.stageThreads.whileTurnRuns = undefined;
      closed = close(before);
    };

    // Waiting for the turn to end would never return: only an interrupt ends it.
    await walkStages(before, [implement, review], taskId);
    await closed;
    expect(before.stageThreads.interrupted).toHaveLength(1);
    expect(before.git.discarded).toEqual([{ taskId, paths: ["src/dialog.ts"] }]);
    expect(before.git.commits).toEqual([]);

    const after = await start([anAgentSession(aDoneResult()), anAgentSession(aDoneResult())]);
    await startUp(after, taskId, "in-progress");

    const [restarted] = await runsOf(after, taskId);
    expect(restarted?.outcome).toEqual({
      status: "failed",
      error:
        "The Office restarted during this Stage. The Office discarded the Stage's uncommitted edits to 1 file.",
      interrupted: "restart",
    });
    expect(after.decisions.on(taskId)).toEqual([
      expect.objectContaining({
        threadId: restarted?.threadId,
        byTheOffice: true,
        draft: expect.objectContaining({
          question: RESTART_QUESTION,
          options: ['Run "Implement" again', "Drop the Task"],
        }),
      }),
    ]);
    expect(after.engine.sessions).toEqual([]);
    expect((await after.tasks.read(taskId)).state).toBe("waiting-on-you");

    await answerLastDecision(after, taskId, {
      kind: "free-answer",
      text: "Skip the dialog's tests.",
    });

    const again = after.stageThreads.requests[0];
    expect(again?.declared).toBeUndefined();
    expect(again?.previousThreadId).toBe(restarted?.threadId);
    expect(again?.work).toContain("## The Office restarted\n\nThe Office restarted while");
    expect(again?.work).toContain("The user's words for it:\n\nSkip the dialog's tests.");
    expect(
      (await runsOf(after, taskId)).map(({ stageKey, outcome }) => [stageKey, outcome?.status]),
    ).toEqual([
      ["implement", "failed"],
      ["implement", "done"],
      ["review", "done"],
    ]);
  });

  it("stops a Script Stage's command, which takes no Stop from the user, so the service doesn't wait for it", async () => {
    const before = await start();
    const taskId = randomUUID();
    before.commands.runsUntilStopped = true;
    let closed: Promise<void> | undefined;
    before.commands.observe = (call) => {
      if (call === "runCommand") closed = close(before);
    };

    await walkStages(before, [tests, review], taskId);
    await closed;

    const after = await start();
    const [run, ...more] = await runsOf(after, taskId);
    expect(run?.outcome).toEqual({
      status: "failed",
      error: "The Office restarted during this Stage. The Stage had left no uncommitted edits.",
      interrupted: "restart",
    });
    expect(run?.commandRuns).toEqual([
      expect.objectContaining({ commandLine: "npm run test", outcome: "stopped" }),
    ]);
    expect(more).toEqual([]);
  });
});

describe("Starting with a run left running", () => {
  it("ends it as The Office restarted during it, discarding its edits, and asks the user rather than running it again", async () => {
    const pipelines = await start();
    const taskId = await aRunLeftRunning(pipelines, [implement, review]);
    pipelines.git.uncommitted.set(taskId, ["src/dialog.ts", "src/dialog.test.ts"]);

    await startUp(pipelines, taskId, "in-progress");

    const [run] = await runsOf(pipelines, taskId);
    expect(run?.outcome).toEqual({
      status: "failed",
      error:
        "The Office restarted during this Stage. The Office discarded the Stage's uncommitted edits to 2 files.",
      interrupted: "restart",
    });
    expect(run?.headCommit).toBe(PLANNED_COMMIT);
    expect(pipelines.decisions.on(taskId).map(({ draft }) => draft.question)).toEqual([
      RESTART_QUESTION,
    ]);
    expect(pipelines.engine.sessions).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("waiting-on-you");
  });

  it("drops the Task when the user answers so", async () => {
    const pipelines = await start();
    const taskId = await aRunLeftRunning(pipelines, [implement]);
    await startUp(pipelines, taskId, "in-progress");

    await answerLastDecision(pipelines, taskId, { kind: "option", option: 1 });

    expect((await pipelines.tasks.read(taskId)).state).toBe("dropped");
    expect(await runsOf(pipelines, taskId)).toHaveLength(1);
    expect(pipelines.engine.sessions).toEqual([]);
  });

  it("keeps a Paused Task Paused, asking only once the user resumes it", async () => {
    const pipelines = await start();
    const taskId = await aRunLeftRunning(pipelines, [implement]);

    await startUp(pipelines, taskId, "paused");

    expect(await outcomesOf(pipelines, taskId)).toEqual([
      expect.objectContaining({ interrupted: "restart" }),
    ]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");

    pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
    const interpreter = pipelines.app.get(StageInterpreter, { strict: false });
    interpreter.walkInBackground(taskId);
    await interpreter.walked(taskId);

    expect(pipelines.decisions.on(taskId).map(({ draft }) => draft.question)).toEqual([
      RESTART_QUESTION,
    ]);
    expect(pipelines.engine.sessions).toEqual([]);
  });

  it("leaves a Stage the user paused before the shutdown as they held it", async () => {
    const pipelines = await start();
    const taskId = await aRunLeftRunning(pipelines, [implement]);
    const [running] = await runsOf(pipelines, taskId);
    if (!running) throw new Error("The run left running is missing.");
    const paused = endStageRun(running, interruptedOutcome("pause", []), new Date());
    await pipelines.app.get(StageRunRepository, { strict: false }).saveEnded(paused.run);

    await startUp(pipelines, taskId, "paused");

    expect(await outcomesOf(pipelines, taskId)).toEqual([paused.run.outcome]);
    expect(pipelines.decisions.on(taskId)).toEqual([]);
    expect(pipelines.git.discarded).toEqual([]);
    expect((await pipelines.tasks.read(taskId)).state).toBe("paused");
  });
});
