import { EventBus } from "../../platform/events/event-bus.js";
import { Schedule } from "../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../platform/schedule/schedule.fixtures.js";
import { AlarmSounded, TaskResumed } from "../work/index.js";
import {
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  type PipelinesApplication,
} from "./pipelines-application.fixtures.js";
import { StageInterpreter } from "./application/stage-interpreter.js";

export const implement = anAgentStage("implement", { name: "Implement" });

export const review = anAgentStage("review", { name: "Review & fix" });

export const HELD =
  "Held by the fire alarm. The Stage's uncommitted edits stay in the worktree for it to go on with after the all clear.";

export const open = new Set<PipelinesApplication>();

export async function start(scripts: Parameters<typeof startPipelinesApplication>[0] = []) {
  const pipelines = await startPipelinesApplication(scripts);
  open.add(pipelines);
  return pipelines;
}

export function scheduleOf({ app }: PipelinesApplication): ManualSchedule {
  return app.get(Schedule, { strict: false }) as ManualSchedule;
}

/** The user sounds the alarm, as Work announces it: each running Task paused by it, then AlarmSounded. */
export async function soundTheAlarm(
  pipelines: PipelinesApplication,
  taskId: string,
): Promise<void> {
  const since = scheduleOf(pipelines).now();
  pipelines.tasks.fireAlarmOn = true;
  await pipelines.tasks.pauseForAlarm(taskId);
  await pipelines.app
    .get(EventBus)
    .publish(new AlarmSounded(since, new Date(since.getTime() + 60_000)));
}

/** Runs `action` once, as the first Stage's first turn runs, which waits for it. */
export function whileTheFirstTurnRuns(
  pipelines: PipelinesApplication,
  action: () => Promise<void>,
): void {
  pipelines.stageThreads.whileTurnRuns = () => {
    pipelines.stageThreads.whileTurnRuns = undefined;
    return action();
  };
}

/** The Task resumed, as the all clear will resume it through Work, waiting for the walk. */
export async function resume(pipelines: PipelinesApplication, taskId: string): Promise<void> {
  pipelines.tasks.fireAlarmOn = false;
  pipelines.tasks.put(taskId, { state: "in-progress", pipelineId: "for-tests" });
  await pipelines.app.get(EventBus).publish(new TaskResumed(taskId));
  await pipelines.app.get(StageInterpreter, { strict: false }).walked(taskId);
}

export async function statusesOf(
  pipelines: PipelinesApplication,
  taskId: string,
): Promise<[string, string | undefined][]> {
  return (await runsOf(pipelines, taskId)).map(({ stageKey, outcome }) => [
    stageKey,
    outcome?.status,
  ]);
}
