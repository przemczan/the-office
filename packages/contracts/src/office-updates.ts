import { z } from "zod";
import { webEventSchema } from "./events.js";

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
