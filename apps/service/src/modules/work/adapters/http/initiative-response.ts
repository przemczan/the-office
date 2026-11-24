import type { Initiative as InitiativeResponse } from "@the-office/contracts";
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
