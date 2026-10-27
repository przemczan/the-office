import { taskStateSchema, type Now as NowResponse } from "@the-office/contracts";
import type { Now, NeedsYouItem, RunningTask } from "../../domain/now.js";

export function toNowResponse(now: Now): NowResponse {
  return {
    needsYou: now.needsYou.map(toNeedsYouResponse),
    running: now.running.map(toRunningResponse),
    leftAt: now.leftAt?.toISOString() ?? null,
    sinceYouLeft: now.sinceYouLeft.map(({ occurredAt, ...finished }) => ({
      ...finished,
      occurredAt: occurredAt.toISOString(),
    })),
    tokensToday: now.tokensToday,
    tasksTouched: now.tasksTouched,
    desks: now.desks,
    fiveHourWindow: now.fiveHourWindow
      ? {
          percentUsed: now.fiveHourWindow.percentUsed,
          resetsAt: now.fiveHourWindow.resetsAt?.toISOString() ?? null,
        }
      : null,
  };
}

function toNeedsYouResponse(item: NeedsYouItem): NowResponse["needsYou"][number] {
  return { ...item, waitingSince: item.waitingSince.toISOString() };
}

function toRunningResponse({ stage, state, ...task }: RunningTask): NowResponse["running"][number] {
  return {
    ...task,
    state: taskStateSchema.parse(state),
    stage: stage
      ? {
          key: stage.key,
          name: stage.name,
          role: stage.role ?? null,
          since: stage.since.toISOString(),
        }
      : null,
  };
}
