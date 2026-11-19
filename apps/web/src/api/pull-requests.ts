import { queryOptions } from "@tanstack/react-query";
import { pullRequestListSchema, type PullRequestWebEvent } from "@the-office/contracts";
import { getFromApi, sendToApiWithNoAnswer } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const PULL_REQUESTS = ["pull-requests"] as const;

export const pullRequestQueries = {
  /**
   * Work › Pull requests: the open pull requests The Office opened, newest first, with each
   * Project's problem; every Project's, or only `projectId`'s.
   */
  list: (projectId?: string) =>
    queryOptions({
      queryKey: [...PULL_REQUESTS, projectId ?? "all"],
      queryFn: ({ signal }) =>
        getFromApi(
          projectId === undefined
            ? "/pull-requests"
            : `/pull-requests?${new URLSearchParams({ projectId })}`,
          pullRequestListSchema,
          signal,
        ),
    }),
};

/**
 * Asks the service to read every open pull request's status from its code host again. It answers at
 * once; what changed arrives as `pull-requests.changed`.
 */
export function refreshPullRequests(): Promise<void> {
  return sendToApiWithNoAnswer("POST", "/pull-requests/refresh", {});
}

export const pullRequestEventInvalidations: Readonly<
  Record<PullRequestWebEvent["type"], EventInvalidations[string]>
> = {
  "pull-requests.changed": () => [PULL_REQUESTS],
};
