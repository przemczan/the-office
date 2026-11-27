import type { DaySummary as DaySummaryResponse } from "@the-office/contracts";
import type { DaySummary } from "../../application/day-summary.js";
import { toPullRequestEndedByResponse } from "./work-responses.js";

const at = (moment: Date): string => moment.toISOString();

/** The day's summary as the contract has it: moments as ISO strings, absent values as null. */
export function toDaySummaryResponse(summary: DaySummary): DaySummaryResponse {
  return {
    day: summary.day,
    today: summary.today,
    initiativesDone: summary.initiativesDone.map((initiative) => ({
      ...initiative,
      projectIds: [...initiative.projectIds],
      at: at(initiative.at),
    })),
    tasksDone: summary.tasksDone.map(({ pullRequestNumber, ...task }) => ({
      ...task,
      pullRequestNumber: pullRequestNumber ?? null,
      at: at(task.at),
    })),
    pullRequestsMerged: summary.pullRequestsMerged.map((merged) => ({
      ...merged,
      by: toPullRequestEndedByResponse(merged.by),
      at: at(merged.at),
    })),
    failedOrDropped: summary.failedOrDropped.map(({ stageName, dropReason, ...task }) => ({
      ...task,
      stageName: stageName ?? null,
      dropReason: dropReason ?? null,
      at: at(task.at),
    })),
    ideasCaptured: summary.ideasCaptured.map(({ projectId, ...idea }) => ({
      ...idea,
      projectId: projectId ?? null,
      at: at(idea.at),
    })),
    tasksStarted: summary.tasksStarted.map((task) => ({ ...task, at: at(task.at) })),
    tokens: summary.tokens,
    elsewhere: summary.elsewhere,
  };
}
