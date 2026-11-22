import type {
  OffBoardTask as OffBoardTaskResponse,
  OffBoardTaskStart as OffBoardTaskStartResponse,
  OffBoardTaskStatus as OffBoardTaskStatusResponse,
  ProjectOffBoardTasks as ProjectOffBoardTasksResponse,
} from "@the-office/contracts";
import type {
  OffBoardTask,
  OffBoardTaskStart,
  OffBoardTaskStatus,
  ProjectOffBoardTasks,
} from "../../domain/off-board-task.js";

/** An Off-board Task as the contracts carry it, for the Project page, Activity and Needs you. */
export function toOffBoardTaskResponse(task: OffBoardTask): OffBoardTaskResponse {
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    title: task.title,
    kind: task.kind,
    status: toStatusResponse(task.status),
    stages: [...task.stages],
    currentStage: task.currentStage ?? null,
    person: task.person ? { roleKey: task.person.roleKey, name: task.person.name } : null,
    threadId: task.threadId ?? null,
    since: task.since.toISOString(),
    tokens: task.tokens,
  };
}

export function toProjectOffBoardTasksResponse(
  tasks: ProjectOffBoardTasks,
): ProjectOffBoardTasksResponse {
  return {
    onboard: tasks.onboard ? toOffBoardTaskResponse(tasks.onboard) : null,
    onboardHistory: tasks.onboardHistory.map(toOffBoardTaskResponse),
    runEnvironmentSetUp: tasks.runEnvironmentSetUp
      ? toOffBoardTaskResponse(tasks.runEnvironmentSetUp)
      : null,
  };
}

export function toOffBoardTaskStartResponse(start: OffBoardTaskStart): OffBoardTaskStartResponse {
  return start.outcome === "refused"
    ? { outcome: "refused", reasons: [...start.reasons] }
    : { outcome: start.outcome, offBoardTask: toOffBoardTaskResponse(start.offBoardTask) };
}

function toStatusResponse(status: OffBoardTaskStatus): OffBoardTaskStatusResponse {
  switch (status.state) {
    case "queued":
      return {
        state: "queued",
        place: status.place,
        shortReasons: [...status.shortReasons],
        queuedAt: status.queuedAt.toISOString(),
      };
    case "waiting-on-you":
      return {
        state: "waiting-on-you",
        decisionId: status.decisionId ?? null,
        question: status.question ?? null,
      };
    case "failed":
      return {
        state: "failed",
        stageName: status.stageName,
        error: status.error ?? null,
        decisionId: status.decisionId,
        withCto: status.withCto,
      };
    case "done":
      return { state: "done", endedAt: status.endedAt?.toISOString() ?? null };
    case "dropped":
      return {
        state: "dropped",
        endedAt: status.endedAt?.toISOString() ?? null,
        dropReason: status.dropReason ?? null,
      };
    default:
      return { state: status.state };
  }
}
