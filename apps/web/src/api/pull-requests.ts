import { queryOptions } from "@tanstack/react-query";
import {
  pullRequestListSchema,
  pullRequestMergeMethodsSchema,
  pullRequestRefusalSchema,
  type MergeMethod,
  type PullRequestRefusal,
  type PullRequestWebEvent,
} from "@the-office/contracts";
import {
  getFromApi,
  RefusedAs,
  sendToApiWithNoAnswer,
  sendToApiWithNoAnswerRefusedAs,
} from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const PULL_REQUESTS = ["pull-requests"] as const;
/**
 * Apart from PULL_REQUESTS, so a `pull-requests.changed` (as when the pull request merges) doesn't
 * read an open Merge window's methods again.
 */
const MERGE_METHODS = ["pull-request-merge-methods"] as const;

export const pullRequestQueries = {
  /** Every list of pull requests, to invalidate once one is merged, closed or read again. */
  all: () => PULL_REQUESTS,
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
  /** The Merge window's methods: those the code host allows, the recommended one and its warning. */
  mergeMethods: (pullRequestId: string) =>
    queryOptions({
      queryKey: [...MERGE_METHODS, pullRequestId],
      queryFn: ({ signal }) =>
        getFromApi(
          `/pull-requests/${pullRequestId}/merge-methods`,
          pullRequestMergeMethodsSchema,
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

/** The refusal's body, its reason also as the error's message. */
const refusalWithMessage = pullRequestRefusalSchema.transform((refusal) => ({
  ...refusal,
  message: refusal.reason,
}));

/** Merges the pull request on its code host by `method`; refused as `pullRequestRefusalOf` reads. */
export function mergePullRequest(pullRequestId: string, method: MergeMethod): Promise<void> {
  return sendToApiWithNoAnswerRefusedAs(
    "POST",
    `/pull-requests/${pullRequestId}/merge`,
    { method },
    refusalWithMessage,
  );
}

/** Closes the pull request on its code host without merging; its branch stays. */
export function closePullRequest(pullRequestId: string): Promise<void> {
  return sendToApiWithNoAnswerRefusedAs(
    "POST",
    `/pull-requests/${pullRequestId}/close`,
    {},
    refusalWithMessage,
  );
}

/** Why the code host or The Office refused a Merge or Close, when that is what `error` is. */
export function pullRequestRefusalOf(error: Error | null): PullRequestRefusal | undefined {
  if (!(error instanceof RefusedAs)) return undefined;
  return pullRequestRefusalSchema.safeParse(error.refusal).data;
}

export const pullRequestEventInvalidations: Readonly<
  Record<PullRequestWebEvent["type"], EventInvalidations[string]>
> = {
  "pull-requests.changed": () => [PULL_REQUESTS],
};
