import { z } from "zod";
import { ciRunStatusSchema } from "./ci-runs.js";
import { connectedDeviceKindSchema, connectedDeviceStateSchema } from "./devices.js";
import { webEventSchema } from "./events.js";
import { environmentCheckStateSchema } from "./projects.js";
import { testInstanceKindSchema } from "./test-instances.js";

/** Where an Activity or an item of other running work leads (spec §2.14). */
export const activityLinkSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
  /** A person's chat Thread, which opens the chat drawer. */
  z.object({ kind: z.literal("chat"), roleKey: z.string().min(1), threadId: z.uuid() }),
  z.object({ kind: z.literal("project"), projectId: z.string().min(1) }),
  /** A page on the Project's code host, such as a CI run's. */
  z.object({ kind: z.literal("url"), url: z.url() }),
]);
export type ActivityLink = z.infer<typeof activityLinkSchema>;

/** What every Activity item has, whatever its kind. */
const activityItemFields = {
  /** Stable across reads. */
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  /** When the item entered the state it is in. */
  since: z.iso.datetime(),
  link: activityLinkSchema,
};

/** An Off-board Task's states Activity lists: queued, at a desk or failed. */
export const activityOffBoardTaskStateSchema = z.enum([
  "queued",
  "in-progress",
  "waiting-on-you",
  "paused",
  "failed",
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

/** The test instance states Activity lists: only one building or running. */
export const activityTestInstanceStateSchema = z.enum(["building", "running"]);
export type ActivityTestInstanceState = z.infer<typeof activityTestInstanceStateSchema>;

/** One piece of other running work: it is listed only while it runs or stalls (spec §2.14). */
export const activityItemSchema = z.discriminatedUnion("kind", [
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
]);
export type ActivityItem = z.infer<typeof activityItemSchema>;
export type ActivityItemKind = ActivityItem["kind"];

/** What a session waits on, with the Decision's one-line question when there is one. */
export const activityWaitingOnSchema = z.object({
  kind: z.enum(["decision", "consultant", "gate", "reply"]),
  question: z.string().nullable(),
});
export type ActivityWaitingOn = z.infer<typeof activityWaitingOnSchema>;

/** Who is in a session: a person, by their Role, or The Office itself (a Gate, a Script Stage). */
export const activityPersonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), roleKey: z.string().min(1) }),
  z.object({ kind: z.literal("the-office") }),
]);
export type ActivityPerson = z.infer<typeof activityPersonSchema>;

/** One active session: its Agent takes a turn, or a Decision in its Thread is open (spec §2.14). */
export const activitySessionSchema = z.object({
  /** Null for The Office's own sessions: a Gate or a Stage with no Agent. */
  threadId: z.uuid().nullable(),
  person: activityPersonSchema,
  sessionKind: z.enum(["stage", "consultation", "thread", "chat", "gate"]),
  /** The Stage it works or waits at, when it is a Stage's. */
  stageName: z.string().nullable(),
  state: z.enum(["working", "waiting"]),
  waitingOn: activityWaitingOnSchema.nullable(),
  since: z.iso.datetime(),
});
export type ActivitySession = z.infer<typeof activitySessionSchema>;

/** What an activity is about: a Task, an Initiative or a chat Thread. */
export const activitySubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    taskId: z.uuid(),
    projectId: z.string().min(1),
    title: z.string(),
    initiativeId: z.uuid().nullable(),
  }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid(), title: z.string() }),
  z.object({
    kind: z.literal("chat"),
    threadId: z.uuid(),
    roleKey: z.string().min(1),
    title: z.string(),
  }),
]);
export type ActivitySubject = z.infer<typeof activitySubjectSchema>;

/** One activity: every active session on one Task, Initiative or chat. */
export const subjectActivitySchema = z.object({
  /** Stable across reads. */
  id: z.string().min(1),
  subject: activitySubjectSchema,
  link: activityLinkSchema,
  /** The earliest of its sessions' `since`. */
  since: z.iso.datetime(),
  sessions: z.array(activitySessionSchema).min(1),
});
export type SubjectActivity = z.infer<typeof subjectActivitySchema>;

/**
 * What `GET /activity` answers for the signed-in user: the activities, newest first, below them the
 * other running work, newest first, and the status strip's count of both.
 */
export const activitySchema = z.object({
  activities: z.array(subjectActivitySchema),
  otherWork: z.array(activityItemSchema),
  count: z.number().int().min(0),
});
export type Activity = z.infer<typeof activitySchema>;

/**
 * Something Activity lists changed: each browser reads `GET /activity` again, as the chats listed
 * differ per user.
 */
export const activityWebEventSchema = webEventSchema.extend({
  type: z.literal("activity.changed"),
});
export type ActivityWebEvent = z.infer<typeof activityWebEventSchema>;
