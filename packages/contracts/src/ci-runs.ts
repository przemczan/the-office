import { z } from "zod";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";

/** Where a CI run stands, in words no code host owns. */
export const CI_RUN_STATUSES = [
  "queued",
  "waiting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
  "unknown",
] as const;
export const ciRunStatusSchema = z.enum(CI_RUN_STATUSES);
export type CiRunStatus = z.infer<typeof ciRunStatusSchema>;

/** Which jobs of a CI run run again: all of them, or only the ones that failed. */
export const CI_RUN_JOBS = ["all", "failed"] as const;
export const ciRunJobsSchema = z.enum(CI_RUN_JOBS);
export type CiRunJobs = z.infer<typeof ciRunJobsSchema>;

/** One run of a workflow on a Project's code host, as Work › CI lists it. */
export const ciRunSchema = z.object({
  /** The code host's id of the run. */
  id: z.number().int().positive(),
  projectId: z.string().min(1),
  /** Its number among its workflow's runs. */
  number: z.number().int().positive(),
  /** 1 for the first run, one more for each re-run. */
  attempt: z.number().int().positive(),
  workflow: z.string(),
  title: z.string(),
  /** What started it, such as push or pull_request, as the code host names it. */
  trigger: z.string(),
  branch: z.string().nullable(),
  /** The commit it ran on, whole. */
  commit: z.string(),
  status: ciRunStatusSchema,
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
  /** Its logs on the code host. */
  url: z.url(),
  /** The Task whose `office/<task id>` branch it ran on; its record may have gone since. */
  taskId: z.uuid().nullable(),
});
export type CiRun = z.infer<typeof ciRunSchema>;

/**
 * Why a Project's CI runs couldn't be listed: its code host refused to be read, in plain words, or
 * couldn't be reached, with when it failed, for the web to show in the user's own time.
 */
export const ciRunProblemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cannot-read"), text: z.string().min(1) }),
  z.object({
    kind: z.literal("unreachable"),
    /** The code host's name, such as GitHub. */
    codeHost: z.string().min(1),
    failedAt: z.iso.datetime({ offset: true }),
  }),
]);
export type CiRunProblem = z.infer<typeof ciRunProblemSchema>;

/** Where one Project's listing of its CI runs stands. */
export const ciRunListingSchema = z.object({
  projectId: z.string().min(1),
  /** When its runs were last listed whole; null when not since the service started. */
  checkedAt: z.iso.datetime({ offset: true }).nullable(),
  /** True when the runs shown may be out of date: the last round was skipped or failed. */
  stale: z.boolean(),
  problem: ciRunProblemSchema.nullable(),
});
export type CiRunListing = z.infer<typeof ciRunListingSchema>;

/** `GET /ci-runs?projectId=`: every Project's, or the one Project's when it is named. */
export const ciRunListQuerySchema = z.object({ projectId: z.string().min(1).optional() });
export type CiRunListQuery = z.infer<typeof ciRunListQuerySchema>;

/** `GET /ci-runs?projectId=`: the runs, newest first, and where each Project's listing stands. */
export const ciRunListSchema = z.object({
  runs: z.array(ciRunSchema),
  projects: z.array(ciRunListingSchema),
});
export type CiRunList = z.infer<typeof ciRunListSchema>;

/** What a re-run asked the code host for. */
export const ciRunRerunSchema = z.object({
  projectId: z.string().min(1),
  runId: z.number().int().positive(),
  jobs: ciRunJobsSchema,
});
export type CiRunRerun = z.infer<typeof ciRunRerunSchema>;

/** Office action: a failed or cancelled CI run runs again. */
export const RERUN_CI_RUN_ACTION = officeAction({
  name: "rerun_ci_run",
  record: "project",
  description:
    "Re-runs a Project's failed or cancelled CI run on its code host, with all its jobs or only the failed ones. Refused for a run that is queued, running, succeeded or skipped, and when the code host refuses, such as without permission to write Actions.",
  input: z.object({
    projectId: z.string().min(1).describe("The id of the Project the run belongs to."),
    runId: z.coerce
      .number()
      .int()
      .positive()
      .describe("The code host's id of the run, as Work › CI lists it."),
    jobs: ciRunJobsSchema.describe("all re-runs every job; failed only the jobs that failed."),
  }),
  answer: ciRunRerunSchema,
  route: { method: "POST", path: "/projects/:projectId/ci-runs/:runId/rerun" },
  duties: ["onboards-projects"],
});

/** Projects' Office actions, each declared above. */
export const PROJECT_OFFICE_ACTIONS = [RERUN_CI_RUN_ACTION] as const;

/** A Project's CI runs changed, so an open CI page refetches them. */
export const ciRunWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("ci-runs.changed") }),
]);
export type CiRunWebEvent = z.infer<typeof ciRunWebEventSchema>;
