import { taskStateSchema, type Now as NowResponse } from "@the-office/contracts";
import type {
  CurrentStage,
  FireAlarmOnNow,
  Now,
  NeedsYouItem,
  RunningTask,
} from "../../domain/now.js";

export function toNowResponse(now: Now): NowResponse {
  return {
    needsYou: now.needsYou.map(toNeedsYouResponse),
    running: now.running.map(toRunningResponse),
    queue: now.queue.map(({ reasons, ...queued }) => ({ ...queued, reasons: [...reasons] })),
    leftAt: now.leftAt?.toISOString() ?? null,
    sinceYouLeft: now.sinceYouLeft.map(({ occurredAt, ...finished }) => ({
      ...finished,
      occurredAt: occurredAt.toISOString(),
    })),
    tokensToday: now.tokensToday,
    tasksTouched: now.tasksTouched,
    desks: now.desks,
    fiveHourWindows: now.fiveHourWindows.map(({ engineId, percentUsed, resetsAt }) => ({
      engineId,
      percentUsed,
      resetsAt: resetsAt?.toISOString() ?? null,
    })),
    fireAlarm: now.fireAlarm ? toFireAlarmResponse(now.fireAlarm) : null,
  };
}

function toNeedsYouResponse(item: NeedsYouItem): NowResponse["needsYou"][number] {
  return { ...item, waitingSince: item.waitingSince.toISOString() };
}

function toRunningResponse({ stage, state, ...task }: RunningTask): NowResponse["running"][number] {
  return { ...task, state: taskStateSchema.parse(state), stage: toStageResponse(stage) };
}

function toFireAlarmResponse({
  since,
  paused,
  ...alarm
}: FireAlarmOnNow): NonNullable<NowResponse["fireAlarm"]> {
  return {
    ...alarm,
    since: since.toISOString(),
    paused: paused.map(({ stage, resume, ...task }) => ({
      ...task,
      stage: toStageResponse(stage),
      resume: resume ? { ...resume, stageName: resume.stageName ?? null } : null,
    })),
  };
}

function toStageResponse(stage: CurrentStage | undefined): NowResponse["running"][number]["stage"] {
  return stage
    ? {
        key: stage.key,
        name: stage.name,
        role: stage.role ?? null,
        since: stage.since.toISOString(),
      }
    : null;
}
