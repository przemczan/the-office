import {
  taskHolderSchema,
  taskStateSchema,
  type Now as NowResponse,
  type SinceYouLeft as SinceYouLeftResponse,
} from "@the-office/contracts";
import type {
  CurrentStage,
  FireAlarmOnNow,
  Now,
  NeedsYouItem,
  RunningTask,
  SinceYouLeft,
  UsageWindow,
} from "../../domain/now.js";

export function toNowResponse(now: Now): NowResponse {
  return {
    needsYou: now.needsYou.map(toNeedsYouResponse),
    running: now.running.map(toRunningResponse),
    queue: now.queue.map(({ reasons, ...queued }) => ({ ...queued, reasons: [...reasons] })),
    shaping: now.shaping.map(({ projectIds, shapedBy, since, ...initiative }) => ({
      ...initiative,
      projectIds: [...projectIds],
      shapedBy: shapedBy ?? null,
      since: since.toISOString(),
    })),
    tokensToday: now.tokensToday,
    desks: now.desks,
    usageWindows: now.usageWindows.map(({ engineId, fiveHour, sevenDay }) => ({
      engineId,
      fiveHour: toUsageWindowResponse(fiveHour),
      sevenDay: toUsageWindowResponse(sevenDay),
    })),
    fireAlarm: now.fireAlarm ? toFireAlarmResponse(now.fireAlarm) : null,
  };
}

export function toSinceYouLeftResponse({ leftAt, finished }: SinceYouLeft): SinceYouLeftResponse {
  return {
    leftAt: leftAt?.toISOString() ?? null,
    finished: finished.map(({ occurredAt, ...task }) => ({
      ...task,
      occurredAt: occurredAt.toISOString(),
    })),
  };
}

function toUsageWindowResponse({
  percentUsed,
  resetsAt,
}: UsageWindow): NowResponse["usageWindows"][number]["fiveHour"] {
  return { percentUsed, resetsAt: resetsAt?.toISOString() ?? null };
}

function toNeedsYouResponse(item: NeedsYouItem): NowResponse["needsYou"][number] {
  const waitingSince = item.waitingSince.toISOString();
  return item.kind === "initiative-decision" || item.kind === "stand-in-choice"
    ? { ...item, projectIds: [...item.projectIds], waitingSince }
    : { ...item, waitingSince };
}

function toRunningResponse({
  stage,
  state,
  pausedBy,
  resumesAt,
  ...task
}: RunningTask): NowResponse["running"][number] {
  return {
    ...task,
    state: taskStateSchema.parse(state),
    pausedBy: pausedBy === undefined ? null : taskHolderSchema.parse(pausedBy),
    resumesAt: resumesAt?.toISOString() ?? null,
    stage: toStageResponse(stage),
  };
}

function toFireAlarmResponse({
  since,
  paused,
  goingOn,
  ...alarm
}: FireAlarmOnNow): NonNullable<NowResponse["fireAlarm"]> {
  return {
    ...alarm,
    since: since.toISOString(),
    goingOn: goingOn.map(({ stage, ...task }) => ({ ...task, stage: toStageResponse(stage) })),
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
