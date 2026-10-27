import { z } from "zod";
import { webEventSchema } from "./events.js";
import { taskStateSchema } from "./work.js";

/** Something that waits on the user, oldest first in Needs you. */
export const needsYouItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("decision"),
    decisionId: z.uuid(),
    taskId: z.uuid(),
    waitingSince: z.iso.datetime(),
  }),
  z.object({
    kind: z.literal("gate"),
    taskId: z.uuid(),
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

/** Now and the status strip: what needs the user, what runs, and the Office's figures. */
export const nowSchema = z.object({
  needsYou: z.array(needsYouItemSchema),
  running: z.array(runningTaskSchema),
  /** Null until the user is first seen. */
  leftAt: z.iso.datetime().nullable(),
  /** Latest first. */
  sinceYouLeft: z.array(finishedTaskSchema),
  tokensToday: z.number().int(),
  /** The Tasks with a Stage run today. */
  tasksTouched: z.number().int().nonnegative(),
  /** The running Tasks against the Office-wide limit. */
  desks: z.object({ inUse: z.number().int().nonnegative(), limit: z.number().int().positive() }),
  /** Null until the engine first reports the account's windows. */
  fiveHourWindow: z
    .object({ percentUsed: z.number(), resetsAt: z.iso.datetime().nullable() })
    .nullable(),
});
export type Now = z.infer<typeof nowSchema>;

export const notificationsWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("now.changed"), now: nowSchema }),
]);
export type NotificationsWebEvent = z.infer<typeof notificationsWebEventSchema>;
