import type {
  Initiative as InitiativeResponse,
  InitiativePauseAnswer,
  ReadyTasksStarted as ReadyTasksStartedResponse,
} from "@the-office/contracts";
import type { InitiativePauseOutcome } from "../../application/initiative-pause.js";
import type { ReadyTasksStarted } from "../../application/initiative-start.js";
import type { InitiativeService } from "../../application/initiative-service.js";
import type { Initiative } from "../../domain/initiative.js";
import { toInitiativeResponse } from "./work-responses.js";

/**
 * The Initiative as every route answering one gives it, with its Tasks from one read of the board:
 * the Initiatives' routes and the Office actions' alike.
 */
export async function initiativeResponse(
  initiatives: InitiativeService,
  initiative: Initiative,
): Promise<InitiativeResponse> {
  const tasks = await initiatives.tasksByInitiative();
  return toInitiativeResponse(initiative, tasks.get(initiative.id) ?? []);
}

/** What Start Ready Tasks did, as every route answering it gives it. */
export function readyTasksStartedResponse({
  started,
  queued,
  refused,
}: ReadyTasksStarted): ReadyTasksStartedResponse {
  return {
    started: started.map(({ id: taskId, title }) => ({ taskId, title })),
    queued: queued.map(({ task, place, reasons }) => ({
      taskId: task.id,
      title: task.title,
      place,
      reasons: [...reasons],
    })),
    refused: refused.map(({ task, reasons }) => ({
      taskId: task.id,
      title: task.title,
      reasons: [...reasons],
    })),
  };
}

/** What Pause or Resume the Initiative did, as every route answering it gives it. */
export async function initiativePauseResponse(
  initiatives: InitiativeService,
  { initiative, taskIds }: InitiativePauseOutcome,
): Promise<InitiativePauseAnswer> {
  return { initiative: await initiativeResponse(initiatives, initiative), taskIds: [...taskIds] };
}
