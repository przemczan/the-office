import { z } from "zod";
import { tokenTotalsSchema } from "./conversations.js";
import { projectFilterParamSchema } from "./project-filter.js";
import { dropReasonSchema, pullRequestEndedBySchema, taskKindSchema } from "./work.js";

/** An office day, `YYYY-MM-DD`: from local midnight to the next on the service's clock. */
export const officeDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The keyword that GET /days/:day takes for the service's current office day. */
export const TODAY_KEYWORD = "today";

/** The query of GET /days/:day: the Projects the Project filter shows, one `project` each. */
export const daySummaryQuerySchema = z.object({ project: projectFilterParamSchema() });
export type DaySummaryQuery = z.infer<typeof daySummaryQuerySchema>;

/** An Initiative that became Done in the day. */
export const dayInitiativeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The Projects its Tasks are in. */
  projectIds: z.array(z.string()),
  taskCount: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});
export type DayInitiative = z.infer<typeof dayInitiativeSchema>;

/** A Task that moved to Done in the day. */
export const dayTaskDoneSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  kind: taskKindSchema,
  /** The number of its pull request, when it has one. */
  pullRequestNumber: z.number().int().positive().nullable(),
  at: z.iso.datetime(),
});
export type DayTaskDone = z.infer<typeof dayTaskDoneSchema>;

/** A Task whose pull request was merged in the day. */
export const dayPullRequestMergedSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  number: z.number().int().positive(),
  url: z.url(),
  by: pullRequestEndedBySchema,
  at: z.iso.datetime(),
});
export type DayPullRequestMerged = z.infer<typeof dayPullRequestMergedSchema>;

/** A Task that failed or was Dropped in the day. */
export const dayFailedOrDroppedSchema = z.object({
  outcome: z.enum(["failed", "dropped"]),
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  /** The Stage that failed; null for a Dropped Task, and for a failure no Stage is named for. */
  stageName: z.string().nullable(),
  /** Why it was Dropped; null when it wasn't, or was dropped with no reason. */
  dropReason: dropReasonSchema.nullable(),
  at: z.iso.datetime(),
});
export type DayFailedOrDropped = z.infer<typeof dayFailedOrDroppedSchema>;

/** An Idea captured in the day. */
export const dayIdeaSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  /** Null for an Idea captured Office-wide. */
  projectId: z.string().nullable(),
  at: z.iso.datetime(),
});
export type DayIdea = z.infer<typeof dayIdeaSchema>;

/** A Task that first moved to In progress in the day. */
export const dayTaskStartedSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  at: z.iso.datetime(),
});
export type DayTaskStarted = z.infer<typeof dayTaskStartedSchema>;

/**
 * GET /days/:day: what The Office did on one office day, each group newest first, archived records
 * included. `today` is the service's office day now, which the web never works out itself.
 * `tokens` are Office-wide whatever the Project filter; `elsewhere` is how many records in all the
 * groups the Project filter hides.
 */
export const daySummarySchema = z.object({
  day: officeDaySchema,
  today: officeDaySchema,
  initiativesDone: z.array(dayInitiativeSchema),
  tasksDone: z.array(dayTaskDoneSchema),
  pullRequestsMerged: z.array(dayPullRequestMergedSchema),
  failedOrDropped: z.array(dayFailedOrDroppedSchema),
  ideasCaptured: z.array(dayIdeaSchema),
  tasksStarted: z.array(dayTaskStartedSchema),
  tokens: tokenTotalsSchema,
  elsewhere: z.number().int().nonnegative(),
});
export type DaySummary = z.infer<typeof daySummarySchema>;
