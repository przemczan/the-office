import { queryOptions } from "@tanstack/react-query";
import {
  ONBOARD_PROJECT_ACTION,
  projectOffBoardTasksSchema,
  type OffBoardTaskStart,
} from "@the-office/contracts";
import { callOfficeAction, getFromApi } from "./api-client.ts";
import { TASKS } from "./work.ts";

/**
 * Each Project's Off-board Tasks (spec §2.1.3): under the Tasks' key, so every Task, queue and
 * Decision event refreshes them; the Stage runs' events name it too, as its current Stage moves.
 */
export const OFF_BOARD_TASKS = [...TASKS, "off-board-tasks"] as const;

export const offBoardTaskQueries = {
  /** The latest Onboard Task, the earlier ones newest first, and the latest run environment set-up. */
  ofProject: (projectId: string) =>
    queryOptions({
      queryKey: [...OFF_BOARD_TASKS, projectId],
      queryFn: ({ signal }) =>
        getFromApi(`${projectPath(projectId)}/off-board-tasks`, projectOffBoardTasksSchema, signal),
    }),
};

/**
 * Onboard, or Onboard again: a new Onboard Task made and started at once, or queued; the one in
 * flight; or refused, with every reason, making nothing.
 */
export function startOnboard(projectId: string): Promise<OffBoardTaskStart> {
  return callOfficeAction(ONBOARD_PROJECT_ACTION, { projectId });
}

function projectPath(id: string): `/${string}` {
  return `/projects/${encodeURIComponent(id)}`;
}
