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

/** What keeps a scheduled Office update waiting, in the UI's words. */
export const busyItemSchema = z.object({
  kind: z.enum([
    "turn",
    "script-stage",
    "publish",
    "clone",
    "environment-check",
    "run-environment",
    "sub-agents",
  ]),
  label: z.string().min(1),
});
export type BusyItem = z.infer<typeof busyItemSchema>;

/** The steps of an Office update the launcher runs, as a failed one names where it stopped. */
export const officeUpdateStepSchema = z.enum(["fetch", "merge", "install", "build"]);
export type OfficeUpdateStep = z.infer<typeof officeUpdateStepSchema>;

/** How the last Office update ended, as the launcher left it. */
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
    finishedAt: z.iso.datetime(),
  }),
]);
export type OfficeUpdateResult = z.infer<typeof officeUpdateResultSchema>;

/** Settings › Updates: the version The Office runs, what its last check found, and a scheduled update. */
export const officeUpdateSchema = z.object({
  current: officeCommitSchema,
  /** What the last check found; absent before the first check ends. */
  check: z
    .object({
      checkedAt: z.iso.datetime(),
      /** The upstream's newest commit; absent when there is no upstream. */
      newest: officeCommitSchema.optional(),
      /** The commits the checkout is behind its upstream, newest first. */
      behind: z.array(officeCommitSchema),
      /** Why the check couldn't read the upstream, such as a failed fetch. */
      problem: z.string().optional(),
    })
    .optional(),
  /** Why Update is refused now; absent when it can go ahead. */
  refusal: z.string().optional(),
  checking: z.boolean(),
  scheduled: z
    .object({
      target: officeCommitSchema,
      scheduledAt: z.iso.datetime(),
      busy: z.array(busyItemSchema),
    })
    .optional(),
  lastResult: officeUpdateResultSchema.optional(),
});
export type OfficeUpdate = z.infer<typeof officeUpdateSchema>;

export const officeUpdateWebEventSchema = z.discriminatedUnion("type", [
  /** A check ended, an update was scheduled or cancelled, or what it waits for changed. */
  webEventSchema.extend({ type: z.literal("office-update.changed") }),
]);
export type OfficeUpdateWebEvent = z.infer<typeof officeUpdateWebEventSchema>;

/** A refused schedule or cancel of an Office update, with its reasons. */
export const officeUpdateRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type OfficeUpdateRefusal = z.infer<typeof officeUpdateRefusalSchema>;
