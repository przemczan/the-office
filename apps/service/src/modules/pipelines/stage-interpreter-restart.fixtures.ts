import { randomUUID } from "node:crypto";
import type { SessionScript } from "../engine/index.js";
import {
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  type PipelinesApplication,
} from "./pipelines-application.fixtures.js";
import type { Stage } from "./domain/stage.js";
import { interruptedOutcome } from "./domain/stage-interruption.js";
import { endStageRun, startStageRun } from "./domain/stage-run-changes.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";
import { StageInterpreter } from "./application/stage-interpreter.js";

export const implement = anAgentStage("implement", { name: "Implement" });

export const review = anAgentStage("review", { name: "Review & fix" });

export const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};

export const RESTART_QUESTION =
  'The Office restarted three times in a row during "Implement". Run it again?';

/** The error of a run The Office restarted during. */
export const RESTARTED =
  "The Office restarted during this Stage, which cut it short. Its uncommitted edits stay in the worktree, and the Stage goes on with them by itself.";

export const open = new Set<PipelinesApplication>();

export async function start(scripts: readonly SessionScript[] = []): Promise<PipelinesApplication> {
  const pipelines = await startPipelinesApplication(scripts);
  open.add(pipelines);
  return pipelines;
}

/** Shuts the service down, as The Office stops. */
export function close(pipelines: PipelinesApplication): Promise<void> {
  open.delete(pipelines);
  return pipelines.app.close();
}

/** The service starting with the Task as Work keeps it, waiting for the walk that may start. */
export async function startUp(
  pipelines: PipelinesApplication,
  taskId: string,
  state: "in-progress" | "paused",
): Promise<void> {
  pipelines.tasks.put(taskId, { state, pipelineId: "for-tests" });
  const interpreter = pipelines.app.get(StageInterpreter, { strict: false });
  await interpreter.onApplicationBootstrap();
  await interpreter.walked(taskId);
}

/**
 * A Task following `stages` whose first Stage's run is still running, as a crash leaves it, in
 * the Stage Thread `threadId` when it has one, after `restartsBefore` runs of the Stage The Office
 * restarted during.
 */
export async function aRunLeftRunning(
  { app }: PipelinesApplication,
  stages: readonly Stage[],
  threadId?: string,
  restartsBefore = 0,
): Promise<string> {
  const taskId = randomUUID();
  await app.get(TaskStagesRepository, { strict: false }).save({
    taskId,
    pipelineId: "for-tests",
    stages,
    madeAt: new Date(),
    editedForTask: false,
    trace: undefined,
  });
  const runs = app.get(StageRunRepository, { strict: false });
  const startRun = (number: number) =>
    startStageRun(
      {
        id: randomUUID(),
        taskId,
        stageKey: stages[0]?.key ?? "",
        carriedFailure: undefined,
        sentBack: undefined,
      },
      number,
      new Date(),
    ).run;
  for (let number = 0; number < restartsBefore; number += 1) {
    const restarted = startRun(number);
    await runs.saveNew(restarted);
    await runs.saveEnded(endStageRun(restarted, interruptedOutcome("restart", []), new Date()).run);
  }
  const run = startRun(restartsBefore);
  await runs.saveNew(run);
  if (threadId) {
    await runs.saveThread(run.id, {
      threadId,
      session: "fresh",
      engineId: "claude-code",
      engineName: "Claude Code",
      model: "scripted",
    });
  }
  return taskId;
}

export function outcomesOf(pipelines: PipelinesApplication, taskId: string): Promise<unknown[]> {
  return runsOf(pipelines, taskId).then((runs) => runs.map(({ outcome }) => outcome));
}
