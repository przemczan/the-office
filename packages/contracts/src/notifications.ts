import { z } from "zod";
import { tokenTotalsSchema } from "./conversations.js";
import { engineIdSchema } from "./engines.js";
import { webEventSchema } from "./events.js";
import { taskStateSchema } from "./work.js";

/** Something that waits on the user, oldest first in Needs you. */
export const needsYouItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("decision"),
    decisionId: z.uuid(),
    taskId: z.uuid(),
    /** The Task's, which the Project filter narrows by. */
    projectId: z.string(),
    waitingSince: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal("gate"),
    taskId: z.uuid(),
    projectId: z.string(),
    stageKey: z.string().min(1),
    waitingSince: z.iso.datetime(),
  }),
]);
export type NeedsYouItem = z.infer<typeof needsYouItemSchema>;

/** The Stage a started Task is at: the one with its latest run. */
export const currentStageSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  /** The Role whose person works it; null for a Script Stage or a Gate. */
  role: z.string().min(1).nullable(),
  /** Time in Stage counts from here. */
  since: z.iso.datetime(),
});
export type CurrentStage = z.infer<typeof currentStageSchema>;

/** A started Task at its desk: In progress, Waiting on you or Paused. */
export const runningTaskSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  state: taskStateSchema,
  /** Null before its first Stage run. */
  stage: currentStageSchema.nullable(),
});
export type RunningTask = z.infer<typeof runningTaskSchema>;

/** A Task in the queue for Start, its place counted from 1, with the waits that hold it. */
export const queuedOnNowSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  place: z.number().int().positive(),
  reasons: z.array(z.string()),
});
export type QueuedOnNow = z.infer<typeof queuedOnNowSchema>;

export const taskOutcomeSchema = z.enum(["done", "failed", "paused"]);
export type TaskOutcome = z.infer<typeof taskOutcomeSchema>;

/** A Task's latest outcome since the user left. */
export const finishedTaskSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  outcome: taskOutcomeSchema,
  occurredAt: z.iso.datetime(),
});
export type FinishedTask = z.infer<typeof finishedTaskSchema>;

/**
 * How a Task the fire alarm paused would go on at the all clear (spec §2.8), through the Context
 * policy: its Agent Stage continues its session with the cache warm (`contextTokens` read from the
 * cache), continues and re-caches `contextTokens`, or starts fresh with a Brief and the Handover
 * note (`briefTokens`); a Script Stage runs its script again; a Publish the alarm let finish is
 * recorded; a Task waiting on the user waits again; anything else goes on with no model call.
 */
export const resumeKindSchema = z.enum([
  "continues-warm",
  "re-caches",
  "fresh",
  "script",
  "publish-finished",
  "waits-on-you",
  "goes-on",
]);
export type ResumeKind = z.infer<typeof resumeKindSchema>;

export const taskResumeSchema = z.object({
  kind: resumeKindSchema,
  /** The Stage it goes on with; null when it has none ahead. */
  stageName: z.string().nullable(),
  contextTokens: z.number().int().nonnegative(),
  briefTokens: z.number().int().nonnegative(),
  /** What resuming costs, in tokens, before work continues. */
  tokens: z.number().int().nonnegative(),
});
export type TaskResume = z.infer<typeof taskResumeSchema>;

/** A Task the fire alarm paused, with how it would go on at the all clear. */
export const alarmPausedTaskSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  stage: currentStageSchema.nullable(),
  /** Null while its Stage is still stopping at its safe point. */
  resume: taskResumeSchema.nullable(),
});
export type AlarmPausedTask = z.infer<typeof alarmPausedTaskSchema>;

/**
 * The fire alarm while it is on: stopping until every Stage it holds has reached its safe point,
 * then the plan the all clear follows, each Task resuming unless the user holds or drops it.
 */
export const fireAlarmOnNowSchema = z.object({
  since: z.iso.datetime(),
  stopping: z.boolean(),
  paused: z.array(alarmPausedTaskSchema),
  /** What resuming every Task it paused costs, in tokens. */
  resumeTokens: z.number().int().nonnegative(),
});
export type FireAlarmOnNow = z.infer<typeof fireAlarmOnNowSchema>;

/** Now and the status strip: what needs the user, what runs, and the Office's figures. */
export const nowSchema = z.object({
  needsYou: z.array(needsYouItemSchema),
  running: z.array(runningTaskSchema),
  /** The queue for Start, first place first. */
  queue: z.array(queuedOnNowSchema),
  /** Null until the user is first seen. */
  leftAt: z.iso.datetime().nullable(),
  /** Latest first. */
  sinceYouLeft: z.array(finishedTaskSchema),
  tokensToday: tokenTotalsSchema,
  /** The Tasks with a Stage run today. */
  tasksTouched: z.number().int().nonnegative(),
  /** The running Tasks against the Office-wide limit. */
  desks: z.object({ inUse: z.number().int().nonnegative(), limit: z.number().int().positive() }),
  /** Each engine's whose account's windows were read, in the order each was first read. */
  fiveHourWindows: z.array(
    z.object({
      engineId: engineIdSchema,
      percentUsed: z.number(),
      resetsAt: z.iso.datetime().nullable(),
    }),
  ),
  /** Null while the fire alarm is off. */
  fireAlarm: fireAlarmOnNowSchema.nullable(),
});
export type Now = z.infer<typeof nowSchema>;

/** The kinds of Notification, a tree of hierarchical keys (spec §2.7). */
export const notificationKindSchema = z.enum([
  "needs-you.decision",
  "needs-you.gate",
  "needs-you.message",
  "outcomes.task-done",
  "outcomes.task-failed",
  "outcomes.task-paused",
  "outcomes.initiative-done",
  "office.window.nearly-used",
  "office.window.reset",
  "office.down.service",
  "office.down.engine",
  "office.alarm-lifted",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** In-app and the desktop live in the browser; the phone is pushed to by the service. */
export const channelSchema = z.enum(["in-app", "desktop", "phone"]);
export type Channel = z.infer<typeof channelSchema>;

/** A channel at one level of the kinds tree: on or off, and the level that sets it (null: none). */
export const routedChannelSchema = z.object({ on: z.boolean(), from: z.string().nullable() });
export type RoutedChannel = z.infer<typeof routedChannelSchema>;

/**
 * What goes where, the grid in Settings › Notifications: each level of the kinds tree (a group,
 * the levels below it and its kinds) with every channel as it routes there.
 */
export const notificationRoutingSchema = z.record(
  z.string(),
  z.record(channelSchema, routedChannelSchema),
);
export type NotificationRouting = z.infer<typeof notificationRoutingSchema>;

/** Sets one channel at a level, for every kind below it that sets nothing of its own. */
export const channelSettingSchema = z.object({ channel: channelSchema, on: z.boolean() });
export type ChannelSetting = z.infer<typeof channelSettingSchema>;

/** What a Notification opens. */
export const pointerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("decision"), decisionId: z.uuid(), taskId: z.uuid() }),
  z.object({ kind: z.literal("gate"), taskId: z.uuid(), stageKey: z.string().min(1) }),
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
  /** The Office's own state, on Now and the status strip; an engine down names its engine. */
  z.object({ kind: z.literal("office"), engineId: z.string().min(1).optional() }),
  /** Now, where Needs you and Since you left show what a Notification gathered. */
  z.object({ kind: z.literal("since-you-left") }),
]);
export type Pointer = z.infer<typeof pointerSchema>;

/**
 * A Notification standing for others rather than for a kind: Outcomes landing close together,
 * collapsed into one, or the summary of what quiet hours held. Neither is a row of the grid.
 */
export const gatheringKindSchema = z.enum(["collapsed-outcomes", "quiet-hours-summary"]);
export type GatheringKind = z.infer<typeof gatheringKindSchema>;

/** A pointer to something that waits on the user or happened, cleared once they handle it. */
export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.union([notificationKindSchema, gatheringKindSchema]),
  /** Who speaks, by their Role's key; null when The Office does. */
  roleKey: z.string().min(1).nullable(),
  /** In the person's first person, or the UI's own voice. */
  line: z.string().min(1),
  pointsTo: pointerSchema,
  /** Where its kind's routing sends it. */
  channels: z.array(channelSchema),
  /** The channels quiet hours hold it from: their summary brings it when they end. */
  held: z.array(channelSchema),
  raisedAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListSchema = z.array(notificationSchema);

/** A time of day on the service's clock, "HH:MM". */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time of day, HH:MM.");

/** How many minutes a wait of the timing takes: at least one, at most an hour. */
export const TIMING_MINUTES_MAX = 60;
const timingMinutesSchema = z.number().int().min(1).max(TIMING_MINUTES_MAX);

/** When Notifications reach the desktop and the phone: "At the desk", "Quiet hours and batching". */
export const notificationTimingSchema = z.object({
  /** Phone pushes wait while The Office was used in the last this many minutes. */
  holdPhoneMinutes: timingMinutesSchema,
  /** Then anything still unhandled goes to the phone after this many minutes more. */
  awayMinutes: timingMinutesSchema,
  /** Outcomes landing within this many minutes collapse into one. */
  batchOutcomesMinutes: timingMinutesSchema,
  /** Null while off; a window ending earlier than it starts runs across midnight. */
  quietHours: z
    .object({ from: timeOfDaySchema, to: timeOfDaySchema })
    .refine(({ from, to }) => from !== to, "Quiet hours end at another time than they start.")
    .nullable(),
});
export type NotificationTiming = z.infer<typeof notificationTimingSchema>;

/** The user is active on this page; opening what a Notification points to handles it. */
export const activitySchema = z.object({
  page: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("now") }),
    z.object({ kind: z.literal("task"), taskId: z.uuid() }),
    z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
    z.object({ kind: z.literal("elsewhere") }),
  ]),
});
export type Activity = z.infer<typeof activitySchema>;

export const notificationsWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("now.changed"), now: nowSchema }),
  webEventSchema.extend({
    type: z.literal("notification.raised"),
    notification: notificationSchema,
    /** The Notifications it takes the place of on every channel. */
    replaces: z.array(z.uuid()),
  }),
  webEventSchema.extend({
    type: z.literal("notifications.cleared"),
    notificationIds: z.array(z.uuid()),
  }),
]);
export type NotificationsWebEvent = z.infer<typeof notificationsWebEventSchema>;
