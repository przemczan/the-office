import { z } from "zod";
import { ciRunStatusSchema } from "./ci-runs.js";
import { connectedDeviceKindSchema, connectedDeviceStateSchema } from "./devices.js";
import { webEventSchema } from "./events.js";
import { environmentCheckStateSchema } from "./projects.js";
import { testInstanceKindSchema } from "./test-instances.js";

/** Where an Activity item leads (spec §2.14, "Items"). */
export const activityLinkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
  z.object({ kind: z.literal("project"), projectId: z.string().min(1) }),
  /** A page on the Project's code host, such as a CI run's. */
  z.object({ kind: z.literal("url"), url: z.url() }),
]);
export type ActivityLink = z.infer<typeof activityLinkSchema>;

/** What every Activity item has, whatever its kind. */
const activityItemFields = {
  /** Stable across reads, and new when the item comes again, so what was seen stays seen. */
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  /** When the item entered the state it is in. */
  since: z.iso.datetime(),
  /** It finished, failed or stopped: it stays listed until the user has seen it. */
  ended: z.boolean(),
  endedAt: z.iso.datetime().nullable(),
  link: activityLinkSchema,
};

/** A Task's states Activity lists: at a desk, or Done once it finished. */
export const activityTaskStateSchema = z.enum(["in-progress", "waiting-on-you", "paused", "done"]);
export type ActivityTaskState = z.infer<typeof activityTaskStateSchema>;

/** An Off-board Task's states Activity lists: queued, at a desk, failed, or ended. */
export const activityOffBoardTaskStateSchema = z.enum([
  "queued",
  "in-progress",
  "waiting-on-you",
  "paused",
  "failed",
  "done",
  "dropped",
]);
export type ActivityOffBoardTaskState = z.infer<typeof activityOffBoardTaskStateSchema>;

/** What an Off-board Task's item has beside every item's fields. */
const offBoardTaskItemFields = {
  taskId: z.uuid(),
  state: activityOffBoardTaskStateSchema,
  /** The Stage it is at, or failed at; null before it started. */
  stageName: z.string().nullable(),
  /** Every Stage run's tokens so far, as Today's tokens counts them. */
  tokens: z.number().int().nonnegative(),
  /** Its place in the queue and the queue's short reasons, while queued; null otherwise. */
  queued: z
    .object({ place: z.number().int().positive(), shortReasons: z.array(z.string()) })
    .nullable(),
};

/** The test instance states Activity lists; a Stopped one isn't. */
export const activityTestInstanceStateSchema = z.enum(["building", "running", "built", "failed"]);
export type ActivityTestInstanceState = z.infer<typeof activityTestInstanceStateSchema>;

/** One thing The Office is doing, or did and the user hasn't seen yet (spec §2.14). */
export const activityItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...activityItemFields,
    kind: z.literal("task"),
    taskId: z.uuid(),
    state: activityTaskStateSchema,
  }),
  /** A Task whose current Stage the user stopped, with no Decision open on it. */
  z.object({
    ...activityItemFields,
    kind: z.literal("stopped-task"),
    taskId: z.uuid(),
    stageName: z.string(),
  }),
  /** A Task whose current Stage failed, with no Decision open on it. */
  z.object({
    ...activityItemFields,
    kind: z.literal("failed-task"),
    taskId: z.uuid(),
    stageName: z.string(),
  }),
  z.object({
    ...activityItemFields,
    kind: z.literal("test-instance"),
    instanceId: z.uuid(),
    testInstanceKind: testInstanceKindSchema,
    state: activityTestInstanceStateSchema,
    branch: z.string().nullable(),
    initiativeId: z.uuid().nullable(),
  }),
  /** A Project command run of an Action, while it is running. */
  z.object({
    ...activityItemFields,
    kind: z.literal("action-run"),
    runId: z.uuid(),
    actionKey: z.string(),
    branch: z.string(),
    startedBy: z.string(),
  }),
  z.object({
    ...activityItemFields,
    kind: z.literal("ci-run"),
    runId: z.number().int().positive(),
    status: ciRunStatusSchema,
    url: z.url(),
    taskId: z.uuid().nullable(),
  }),
  z.object({
    ...activityItemFields,
    kind: z.literal("environment-check"),
    state: environmentCheckStateSchema,
  }),
  /** A Project's Onboard Task, an Off-board Task listed once, as this kind rather than as a `task`. */
  z.object({
    ...activityItemFields,
    ...offBoardTaskItemFields,
    kind: z.literal("onboarding"),
  }),
  /** A Project's "Set up the run environment" Off-board Task, listed once, never as a `task`. */
  z.object({
    ...activityItemFields,
    ...offBoardTaskItemFields,
    kind: z.literal("run-environment-set-up"),
  }),
  z.object({
    ...activityItemFields,
    kind: z.literal("connected-device"),
    deviceId: z.uuid(),
    deviceKind: connectedDeviceKindSchema,
    state: connectedDeviceStateSchema.exclude(["disconnected"]),
    taskId: z.uuid(),
  }),
  /** An open pull request ready to merge. */
  z.object({
    ...activityItemFields,
    kind: z.literal("pull-request"),
    pullRequestId: z.uuid(),
    number: z.number().int().positive(),
    url: z.url(),
    taskId: z.uuid(),
  }),
]);
export type ActivityItem = z.infer<typeof activityItemSchema>;
export type ActivityItemKind = ActivityItem["kind"];

/**
 * What `GET /activity` answers for the signed-in user: the running items first, then the ended
 * ones they haven't seen, newest first, and the status strip's count of both.
 */
export const activitySchema = z.object({
  items: z.array(activityItemSchema),
  count: z.number().int().min(0),
});
export type Activity = z.infer<typeof activitySchema>;

/** `POST /activity/seen`: the items the signed-in user has seen. */
export const activitySeenSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(500),
});
export type ActivitySeen = z.infer<typeof activitySeenSchema>;

/**
 * Something Activity lists changed, or a user marked items seen: each browser reads
 * `GET /activity` again, as what was seen differs per user.
 */
export const activityWebEventSchema = webEventSchema.extend({
  type: z.literal("activity.changed"),
});
export type ActivityWebEvent = z.infer<typeof activityWebEventSchema>;
