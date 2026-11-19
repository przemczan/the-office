import { z } from "zod";
import { webEventSchema } from "./events.js";

/** Where a pull request stands on its code host. */
export const PULL_REQUEST_STATES = ["open", "merged", "closed"] as const;
export const pullRequestStateSchema = z.enum(PULL_REQUEST_STATES);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

/**
 * Its checks, taken together: failing when any fails, else pending while any runs, else passing,
 * none when it has no checks, and unknown when the code host refused to say.
 */
export const PULL_REQUEST_CHECKS = ["passing", "failing", "pending", "none", "unknown"] as const;
export const pullRequestChecksSchema = z.enum(PULL_REQUEST_CHECKS);
export type PullRequestChecks = z.infer<typeof pullRequestChecksSchema>;

/** Whether it merges into its base: yes, not without resolving conflicts, or not worked out yet. */
export const PULL_REQUEST_MERGEABLE = ["yes", "conflicts", "unknown"] as const;
export const pullRequestMergeableSchema = z.enum(PULL_REQUEST_MERGEABLE);
export type PullRequestMergeable = z.infer<typeof pullRequestMergeableSchema>;

/** An open pull request The Office opened, as Work › Pull requests lists it. */
export const pullRequestSchema = z.object({
  id: z.uuid(),
  projectId: z.string().min(1),
  /** The Task that opened it; its record may have gone since. */
  taskId: z.uuid(),
  number: z.number().int().positive(),
  /** Its page on the code host. */
  url: z.url(),
  title: z.string(),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  openedAt: z.iso.datetime({ offset: true }),
  checks: pullRequestChecksSchema,
  mergeable: pullRequestMergeableSchema,
  /** When its status was last read from the code host; null before the first read. */
  checkedAt: z.iso.datetime({ offset: true }).nullable(),
  /** True when the last refresh couldn't read it, so the status shown may be out of date. */
  stale: z.boolean(),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;

/**
 * Why a Project's pull requests couldn't be refreshed: its code host refused to be read, in plain
 * words, or couldn't be reached, with when it failed and when it was last read, for the web to show
 * in the user's own time.
 */
export const pullRequestProblemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cannot-read"),
    projectId: z.string().min(1),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal("unreachable"),
    projectId: z.string().min(1),
    /** The code host's name, such as GitHub. */
    codeHost: z.string().min(1),
    failedAt: z.iso.datetime({ offset: true }),
    /** When its pull requests were last read whole; null when not since the service started. */
    lastReadAt: z.iso.datetime({ offset: true }).nullable(),
  }),
]);
export type PullRequestProblem = z.infer<typeof pullRequestProblemSchema>;

/** `GET /pull-requests?projectId=`: every Project's, or the one Project's when it is named. */
export const pullRequestListQuerySchema = z.object({ projectId: z.string().min(1).optional() });
export type PullRequestListQuery = z.infer<typeof pullRequestListQuerySchema>;

/** `GET /pull-requests?projectId=`: the open pull requests, newest first, and each Project's problem. */
export const pullRequestListSchema = z.object({
  pullRequests: z.array(pullRequestSchema),
  problems: z.array(pullRequestProblemSchema),
});
export type PullRequestList = z.infer<typeof pullRequestListSchema>;

/** How a pull request's commits land on its base: a merge commit, squashed into one, or rebased. */
export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export const mergeMethodSchema = z.enum(MERGE_METHODS);
export type MergeMethod = z.infer<typeof mergeMethodSchema>;

/** `GET /pull-requests/:id/merge-methods`: what the Merge dialog offers and picks. */
export const pullRequestMergeMethodsSchema = z.object({
  /** In MERGE_METHODS' order; all three when the code host doesn't say. */
  allowed: z.array(mergeMethodSchema).min(1),
  /** Squash for a Task's pull request, merge for an `initiative/` one, else the first allowed. */
  recommended: mergeMethodSchema,
  /** Why the recommended method isn't the usual one, such as squash rewriting an Initiative's commits. */
  warning: z.string().nullable(),
  /** Whether the code host deletes the branch once merged; null when it doesn't say. */
  deletesBranchOnMerge: z.boolean().nullable(),
});
export type PullRequestMergeMethods = z.infer<typeof pullRequestMergeMethodsSchema>;

/** `POST /pull-requests/:id/merge`. */
export const pullRequestMergeSchema = z.object({ method: mergeMethodSchema });
export type PullRequestMerge = z.infer<typeof pullRequestMergeSchema>;

/**
 * A 409 from `POST /pull-requests/:id/merge` or `/close`: why the code host or The Office refused,
 * in plain words quoting the code host's own message. `refresh` is true when the pull request
 * changed since The Office last read it, so the dialog offers Refresh.
 */
export const pullRequestRefusalSchema = z.object({
  reason: z.string().min(1),
  refresh: z.boolean(),
});
export type PullRequestRefusal = z.infer<typeof pullRequestRefusalSchema>;

/** The pull requests or their status changed, so an open Pull requests page refetches them. */
export const pullRequestWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("pull-requests.changed") }),
]);
export type PullRequestWebEvent = z.infer<typeof pullRequestWebEventSchema>;
