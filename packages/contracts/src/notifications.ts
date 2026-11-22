import { z } from "zod";
import { tokenTotalsSchema } from "./conversations.js";
import { engineIdSchema } from "./engines.js";
import { officeUpdateTargetSchema } from "./office-updates.js";
import { webEventSchema } from "./events.js";
import { fireAlarmWaySchema, taskHolderSchema, taskStateSchema } from "./work.js";

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
  /** A Decision on no Task, opened in an Initiative's shaping or planning Thread. */
  z.object({
    kind: z.literal("initiative-decision"),
    decisionId: z.uuid(),
    initiativeId: z.uuid(),
    /** The Initiative's Thread it waits in, where it is answered. */
    threadId: z.uuid(),
    /** The Projects the Initiative spans, which the Project filter narrows by. */
    projectIds: z.array(z.string()),
    waitingSince: z.iso.datetime(),
  }),
  /**
   * The Office's own Decision on the Stages waiting for the user's choice of a Stand-in Engine
   * (spec 5.4): one card for them all, its rows read from `GET /stand-in-choices`.
   */
  z.object({
    kind: z.literal("stand-in-choice"),
    /** The Projects of the waiting Stages' Tasks, which the Project filter narrows by. */
    projectIds: z.array(z.string()),
    /** The oldest waiting Stage's. */
    waitingSince: z.iso.datetime(),
    /** How many Stages wait. */
    count: z.int().positive(),
  }),
]);
export type NeedsYouItem = z.infer<typeof needsYouItemSchema>;

/** Where an open Proposal's Thread lives: a chat, a Task or an Initiative. */
export const proposalHomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), roleKey: z.string().min(1) }),
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
]);
export type ProposalHome = z.infer<typeof proposalHomeSchema>;

/**
 * Something that waits on the user without blocking anyone (spec §2.4.2, "Waiting for you"). Each
 * names the Projects the Project filter narrows by: none for an Office-wide item, shown whatever
 * the filter.
 */
export const waitingForYouItemSchema = z.discriminatedUnion("kind", [
  /** An open Proposal in any Thread, until it is applied or declined. */
  z.object({
    kind: z.literal("proposal"),
    proposalId: z.uuid(),
    threadId: z.uuid(),
    /** Who drafted it, by their Role's key. */
    draftedBy: z.string().min(1),
    home: proposalHomeSchema,
    projectIds: z.array(z.string()),
    waitingSince: z.iso.datetime(),
  }),
  /** An open pull request whose checks fail or which has conflicts. */
  z.object({
    kind: z.literal("pull-request"),
    pullRequestId: z.uuid(),
    /** The Task that opened it. */
    taskId: z.uuid(),
    number: z.int().positive(),
    url: z.url(),
    checksFailing: z.boolean(),
    conflicts: z.boolean(),
    projectIds: z.array(z.string()),
    /** When its status was last read, or when it was opened before the first read. */
    waitingSince: z.iso.datetime(),
  }),
  /** Every installed Skill with an update available, as one item. */
  z.object({
    kind: z.literal("skill-updates"),
    skillNames: z.array(z.string().min(1)).min(1),
    count: z.int().positive(),
    projectIds: z.array(z.string()),
    /** An update has no time it was found. */
    waitingSince: z.null(),
  }),
  /** An Office update found, until it is scheduled or applied. */
  z.object({
    kind: z.literal("office-update"),
    target: officeUpdateTargetSchema,
    projectIds: z.array(z.string()),
    /** When this target was first found. */
    waitingSince: z.iso.datetime(),
  }),
  /** An Initiative in Shaping whose shaper has answered and waits on the user's reply. */
  z.object({
    kind: z.literal("shaping-reply"),
    initiativeId: z.uuid(),
    /** Its shaping Thread, where the user replies. */
    threadId: z.uuid(),
    /** The shaper, by their Role's key. */
    roleKey: z.string().min(1),
    projectIds: z.array(z.string()),
    /** The shaper's last message. */
    waitingSince: z.iso.datetime(),
  }),
]);
export type WaitingForYouItem = z.infer<typeof waitingForYouItemSchema>;

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
  /** What holds a Paused Task apart from the user's own Pause, as the Task's `pausedBy`. */
  pausedBy: taskHolderSchema.nullable(),
  /** When a Task the usage window paused resumes by itself. */
  resumesAt: z.iso.datetime().nullable(),
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

/**
 * An Initiative being shaped (the user's request of 2026-11-15): its Tasks so far, the Projects
 * they are in, and who shapes it.
 */
export const shapingOnNowSchema = z.object({
  initiativeId: z.uuid(),
  title: z.string(),
  /** The Projects its Tasks so far are in, which the Project filter narrows by. */
  projectIds: z.array(z.string()),
  /** Who holds Shapes Initiatives, by their Role's key; null while nobody does. */
  shapedBy: z.string().min(1).nullable(),
  taskCount: z.number().int().nonnegative(),
  /** Shaping counts from here. */
  since: z.iso.datetime(),
});
export type ShapingOnNow = z.infer<typeof shapingOnNowSchema>;

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

/** A started Task a softer fire alarm lets go on, with the Stage it is at. */
export const alarmGoingOnTaskSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
  projectId: z.string(),
  stage: currentStageSchema.nullable(),
});
export type AlarmGoingOnTask = z.infer<typeof alarmGoingOnTaskSchema>;

/**
 * The fire alarm while it is on, with the way it was sounded: stopping until every Stage it holds
 * has reached its safe point, then the plan the all clear follows, each Task resuming unless the
 * user holds or drops it. Under a softer way, the started Tasks it lets go on: to the end of their
 * Stage after the current Stages, of their Task after the current Tasks.
 */
export const fireAlarmOnNowSchema = z.object({
  since: z.iso.datetime(),
  way: fireAlarmWaySchema,
  stopping: z.boolean(),
  paused: z.array(alarmPausedTaskSchema),
  goingOn: z.array(alarmGoingOnTaskSchema),
  /** What resuming every Task it paused costs, in tokens. */
  resumeTokens: z.number().int().nonnegative(),
});
export type FireAlarmOnNow = z.infer<typeof fireAlarmOnNowSchema>;

/** One of an account's usage windows; `resetsAt` is null while the window has not begun. */
export const usageWindowSchema = z.object({
  percentUsed: z.number(),
  resetsAt: z.iso.datetime().nullable(),
});

/** The 5-hour window's use from which "Window nearly used" is raised, and the strip turns amber. */
export const WINDOW_NEARLY_USED_PERCENT = 90;

/**
 * Since you left for the user asking: where it begins, at the start of their own last absence,
 * and each Task's latest outcome since then. Read again on each `now.changed`.
 */
export const sinceYouLeftSchema = z.object({
  /** Null until the user is first seen. */
  leftAt: z.iso.datetime().nullable(),
  /** Latest first. */
  finished: z.array(finishedTaskSchema),
});
export type SinceYouLeft = z.infer<typeof sinceYouLeftSchema>;

/** Now and the status strip: what needs the user, what runs, and the Office's figures. */
export const nowSchema = z.object({
  needsYou: z.array(needsYouItemSchema),
  /**
   * What waits on the user without blocking anyone, oldest first, undated items last. Its count is
   * its own length, narrowed by the Project filter; it never adds to Needs you's count or the tab
   * title.
   */
  waitingForYou: z.array(waitingForYouItemSchema),
  running: z.array(runningTaskSchema),
  /** The queue for Start, first place first. */
  queue: z.array(queuedOnNowSchema),
  /** The Initiatives in Shaping, oldest first. */
  shaping: z.array(shapingOnNowSchema),
  tokensToday: tokenTotalsSchema,
  /** The running Tasks against the Office-wide limit. */
  desks: z.object({ inUse: z.number().int().nonnegative(), limit: z.number().int().positive() }),
  /** Each engine whose account's windows were read, in the order each was first read. */
  usageWindows: z.array(
    z.object({
      engineId: engineIdSchema,
      fiveHour: usageWindowSchema,
      sevenDay: usageWindowSchema,
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
  "outcomes.test-instance.running",
  "outcomes.test-instance.built",
  "outcomes.test-instance.failed",
  "office.window.nearly-used",
  "office.window.used-up",
  "office.window.reset",
  "office.down.service",
  "office.down.engine",
  "office.alarm-lifted",
  "office.update.done",
  "office.update.failed",
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
  /**
   * The Initiative page; for a Decision on no Task in one of its Threads, that Thread with the
   * Decision brought into view.
   */
  z.object({
    kind: z.literal("initiative"),
    initiativeId: z.uuid(),
    decisionId: z.uuid().optional(),
    threadId: z.uuid().optional(),
  }),
  /** The Office's own state, on Now and the status strip; an engine down names its engine. */
  z.object({ kind: z.literal("office"), engineId: z.string().min(1).optional() }),
  /** Now, where Needs you and Since you left show what a Notification gathered. */
  z.object({ kind: z.literal("since-you-left") }),
  /** Settings › Updates, with the last Office update's result and its log. */
  z.object({ kind: z.literal("office-update") }),
  /** Now's Needs you, with the card of the Stages waiting for a Stand-in Engine. */
  z.object({ kind: z.literal("stand-in-choice") }),
  /**
   * A test instance, in the Test instances fold of its Initiative's page, or of its Project's Test
   * targets when it is linked to none.
   */
  z.object({
    kind: z.literal("test-instance"),
    instanceId: z.uuid(),
    projectId: z.string().min(1),
    initiativeId: z.uuid().optional(),
  }),
]);
export type Pointer = z.infer<typeof pointerSchema>;

/**
 * A Notification standing for others rather than for a kind: Outcomes landing close together,
 * collapsed into one, or the summary of what quiet hours held. Neither is a row of the grid.
 */
export const gatheringKindSchema = z.enum(["collapsed-outcomes", "quiet-hours-summary"]);
export type GatheringKind = z.infer<typeof gatheringKindSchema>;

/**
 * Where a Notification's lines put the instant it names (`at`), mirroring the Notifications
 * module's own: the web words it in the browser's time zone.
 */
export const NOTIFICATION_TIME = "{time}";

/** A pointer to something that waits on the user or happened, cleared once they handle it. */
export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.union([notificationKindSchema, gatheringKindSchema]),
  /** Who speaks, by their Role's key; null when The Office does. */
  roleKey: z.string().min(1).nullable(),
  /** In the person's first person, or the UI's own voice. */
  line: z.string().min(1),
  /**
   * The line cut to fit the status strip, never in a person's voice, as the strip shows who says
   * it beside it. Only The Office's own kinds have one; the strip shows `line` without it.
   */
  shortLine: z.string().min(1).optional(),
  /**
   * The instant `line` and `shortLine` name, as a usage window's reset: they hold
   * `NOTIFICATION_TIME` where it goes, which the web words in the browser's time zone. Absent when
   * they name none, and on those raised before it (2026-11-16), whose lines are worded already.
   */
  at: z.iso.datetime().optional(),
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
export const userActivityReportSchema = z.object({
  page: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("now") }),
    z.object({ kind: z.literal("task"), taskId: z.uuid() }),
    z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
    z.object({ kind: z.literal("office-update") }),
    /** A Project's Test targets, with its Test instances. */
    z.object({ kind: z.literal("test-instances"), projectId: z.string().min(1) }),
    z.object({ kind: z.literal("elsewhere") }),
  ]),
});
export type UserActivityReport = z.infer<typeof userActivityReportSchema>;

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
