import { z } from "zod";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";

/** A commit of The Office's own checkout. */
export const officeCommitSchema = z.object({
  commit: z.string().min(1),
  shortCommit: z.string().min(1),
  subject: z.string(),
  committedAt: z.iso.datetime(),
});
export type OfficeCommit = z.infer<typeof officeCommitSchema>;

/** What keeps a scheduled Office update or restart waiting, in the UI's words. */
export const busyItemSchema = z.object({
  kind: z.enum([
    "turn",
    "script-stage",
    "publish",
    "clone",
    "environment-check",
    "run-environment",
    "sub-agents",
    "action-run",
  ]),
  label: z.string().min(1),
});
export type BusyItem = z.infer<typeof busyItemSchema>;

/**
 * The steps of an Office update, as a failed one names where it stopped: a checkout's (fetch to
 * build), and a release's or a container's (download to start).
 */
export const officeUpdateStepSchema = z.enum([
  "fetch",
  "merge",
  "install",
  "build",
  "download",
  "verify",
  "unpack",
  "switch",
  "start",
]);
export type OfficeUpdateStep = z.infer<typeof officeUpdateStepSchema>;

/** How The Office was installed: a git checkout, a release tarball under its launcher, or a container. */
export const officeInstallSchema = z.enum(["checkout", "release", "container"]);
export type OfficeInstall = z.infer<typeof officeInstallSchema>;

/** A released version of The Office newer than the one running, as GitHub Releases has it. */
export const officeReleaseNoteSchema = z.object({
  version: z.string().min(1),
  name: z.string(),
  publishedAt: z.iso.datetime(),
  /** The release's notes, in Markdown. */
  notes: z.string(),
  url: z.url(),
});
export type OfficeReleaseNote = z.infer<typeof officeReleaseNoteSchema>;

/** What a scheduled Office update installs: a checkout's commit, or a released version. */
export const officeUpdateTargetSchema = z.discriminatedUnion("kind", [
  officeCommitSchema.extend({ kind: z.literal("commit") }),
  officeReleaseNoteSchema.omit({ notes: true }).extend({ kind: z.literal("release") }),
]);
export type OfficeUpdateTarget = z.infer<typeof officeUpdateTargetSchema>;

/**
 * How the last Office update ended, as the launcher or the Office updater left it. `from` and `to`
 * are commits for a checkout and versions for a release or a container.
 */
export const officeUpdateResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("updated"),
    from: z.string(),
    to: z.string(),
    finishedAt: z.iso.datetime(),
  }),
  z.object({
    outcome: z.literal("failed"),
    from: z.string(),
    to: z.string(),
    failedStep: officeUpdateStepSchema,
    /** Going back to `from` failed too, so The Office may run neither. */
    rollbackFailed: z.literal(true).optional(),
    finishedAt: z.iso.datetime(),
  }),
]);
export type OfficeUpdateResult = z.infer<typeof officeUpdateResultSchema>;

/**
 * Settings › Updates: the version The Office runs, what its last check found, whether it can
 * restart, and a scheduled update or restart.
 */
export const officeUpdateSchema = z.object({
  /** The Office release's version, as `1.2.3`; absent when The Office runs from a checkout. */
  version: z.string().min(1).optional(),
  install: officeInstallSchema,
  current: officeCommitSchema,
  /** What the last check found; absent before the first check ends. */
  check: z
    .object({
      checkedAt: z.iso.datetime(),
      /** A checkout's: the upstream's newest commit; absent when there is no upstream. */
      newest: officeCommitSchema.optional(),
      /** A checkout's: the commits it is behind its upstream, newest first. */
      behind: z.array(officeCommitSchema),
      /** A release's or a container's: the released versions newer than it, newest first. */
      releases: z.array(officeReleaseNoteSchema),
      /** Why the check couldn't read the upstream or GitHub Releases, such as a failed fetch. */
      problem: z.string().optional(),
    })
    .optional(),
  /** Why Update is refused now; absent when it can go ahead. */
  refusal: z.string().optional(),
  /** Restart The Office. */
  restart: z.object({
    /** Why Restart is refused now, such as nothing here starting The Office again; absent when it can be scheduled. */
    refusal: z.string().optional(),
  }),
  checking: z.boolean(),
  /** The scheduled update or restart, one at a time, with what it waits for. */
  scheduled: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("update"),
        target: officeUpdateTargetSchema,
        scheduledAt: z.iso.datetime(),
        busy: z.array(busyItemSchema),
      }),
      z.object({
        kind: z.literal("restart"),
        scheduledAt: z.iso.datetime(),
        busy: z.array(busyItemSchema),
      }),
    ])
    .optional(),
  lastResult: officeUpdateResultSchema.optional(),
});
export type OfficeUpdate = z.infer<typeof officeUpdateSchema>;

export const officeUpdateWebEventSchema = z.discriminatedUnion("type", [
  /** A check ended, an update or restart was scheduled or cancelled, or what it waits for changed. */
  webEventSchema.extend({ type: z.literal("office-update.changed") }),
]);
export type OfficeUpdateWebEvent = z.infer<typeof officeUpdateWebEventSchema>;

/** A refused schedule or cancel of an Office update or restart, with its reasons. */
export const officeUpdateRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type OfficeUpdateRefusal = z.infer<typeof officeUpdateRefusalSchema>;

const WAITS_FOR_RUNNING_WORK =
  "It waits for the running work to end, an Agent's turn included (this session's too), and then ends every session: Agents' sessions, chats and Stage Threads alike. Refused with its reasons when it can't be scheduled now.";

/** Office action: Check for updates (Settings › Updates). */
export const CHECK_FOR_UPDATES_ACTION = officeAction({
  name: "check_for_updates",
  title: "Check for Office updates",
  description:
    "Checks now whether a newer Office is available, from the upstream of a checkout or from GitHub Releases, and answers the update: the version The Office runs, what the check found, and any update or restart scheduled.",
  input: z.object({}),
  answer: officeUpdateSchema,
  route: { method: "POST", path: "/office-update/check" },
  area: "operations",
  group: "checks",
  subject: () => ({ kind: "office-setting", id: "office-update" }),
});

/** Office action: schedule an Office update. */
export const SCHEDULE_OFFICE_UPDATE_ACTION = officeAction({
  name: "schedule_office_update",
  title: "Schedule an Office update",
  description: `Schedules an update of The Office to the newest version the last check found, after a fresh check. ${WAITS_FOR_RUNNING_WORK}`,
  input: z.object({}),
  answer: z.void(),
  route: { method: "POST", path: "/office-update/schedule" },
  status: 204,
  area: "operations",
  group: "updatesAndRestarts",
  subject: () => ({ kind: "office-setting", id: "office-update" }),
});

/** Office action: cancel the scheduled Office update. */
export const CANCEL_OFFICE_UPDATE_ACTION = officeAction({
  name: "cancel_office_update",
  title: "Cancel the scheduled Office update",
  description:
    "Cancels the scheduled Office update, so The Office goes on running as it is; Tasks waiting for it start again.",
  input: z.object({}),
  answer: z.void(),
  route: { method: "DELETE", path: "/office-update/schedule" },
  status: 204,
  area: "operations",
  group: "updatesAndRestarts",
  subject: () => ({ kind: "office-setting", id: "office-update" }),
});

/** Office action: schedule an Office restart. */
export const SCHEDULE_OFFICE_RESTART_ACTION = officeAction({
  name: "schedule_office_restart",
  title: "Schedule an Office restart",
  description: `Schedules a restart of The Office, which starts again as it is. ${WAITS_FOR_RUNNING_WORK}`,
  input: z.object({}),
  answer: z.void(),
  route: { method: "POST", path: "/office-restart/schedule" },
  status: 204,
  area: "operations",
  group: "updatesAndRestarts",
  subject: () => ({ kind: "office-setting", id: "office-restart" }),
});

/** Office action: cancel the scheduled Office restart. */
export const CANCEL_OFFICE_RESTART_ACTION = officeAction({
  name: "cancel_office_restart",
  title: "Cancel the scheduled Office restart",
  description:
    "Cancels the scheduled Office restart, so The Office goes on running; Tasks waiting for it start again.",
  input: z.object({}),
  answer: z.void(),
  route: { method: "DELETE", path: "/office-restart/schedule" },
  status: 204,
  area: "operations",
  group: "updatesAndRestarts",
  subject: () => ({ kind: "office-setting", id: "office-restart" }),
});

/** Office updates' Office actions, each declared above. */
export const OFFICE_UPDATE_OFFICE_ACTIONS = [
  CHECK_FOR_UPDATES_ACTION,
  SCHEDULE_OFFICE_UPDATE_ACTION,
  CANCEL_OFFICE_UPDATE_ACTION,
  SCHEDULE_OFFICE_RESTART_ACTION,
  CANCEL_OFFICE_RESTART_ACTION,
] as const;
