import { z } from "zod";
import { contextMoveSchema, tokenTotalsSchema } from "./conversations.js";
import { webEventSchema } from "./events.js";

/** "On failure go back to Stage X, at most N times": the Stage's key and its rounds. */
export const onFailureSchema = z.object({
  goBackTo: z.string().min(1),
  rounds: z.int().positive(),
});

const stageFields = {
  key: z.string().min(1),
  name: z.string(),
  optional: z.boolean(),
};

export const stageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    ...stageFields,
    /** The key of the Role that works it. */
    role: z.string(),
    brief: z.string(),
    session: z.enum(["fresh", "continue"]),
    /** Tokens. */
    budget: z.int().positive(),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({
    kind: z.literal("script"),
    ...stageFields,
    command: z.enum(["build", "lint", "test", "publish"]),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({ kind: z.literal("gate"), ...stageFields }),
]);
export type Stage = z.infer<typeof stageSchema>;

export const pipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  stages: z.array(stageSchema),
});
export type Pipeline = z.infer<typeof pipelineSchema>;

export const pipelineListSchema = z.array(pipelineSchema);

/** Where one of a started Task's Stages stands, from its latest run. */
export const stageStateSchema = z.enum([
  "pending",
  "running",
  "waiting-on-you",
  "done",
  "skipped",
  "failed",
]);
export type StageState = z.infer<typeof stageStateSchema>;

/** "On failure go back": where the loop went back to, and which time of how many. */
export const wentBackSchema = z.object({
  stageKey: z.string(),
  round: z.int().positive(),
  rounds: z.int().positive(),
});
export type WentBack = z.infer<typeof wentBackSchema>;

const handoverNoteField = { handoverNote: z.string().nullable() };

/** How a Stage run ended, with its Agent's Handover note when it wrote one. */
export const stageRunOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("done"),
    summary: z.string(),
    /** An optional Stage skipped, which ran nothing. */
    skipped: z.boolean(),
    ...handoverNoteField,
  }),
  z.object({ status: z.literal("needs-decision"), question: z.string(), ...handoverNoteField }),
  z.object({
    status: z.literal("failed"),
    error: z.string(),
    /** Set when the Task's tokens reached the Stage's budget. */
    budgetReached: z
      .object({ used: z.int().nonnegative(), budget: z.int().nonnegative() })
      .nullable(),
    ...handoverNoteField,
  }),
]);
export type StageRunOutcome = z.infer<typeof stageRunOutcomeSchema>;

/** A Project command The Office ran for a Stage run. */
export const stageCommandRunSchema = z.object({
  /** The install before the Stage, the Script Stage's command, or a failing test's re-run. */
  purpose: z.enum(["install", "command", "re-run"]),
  commandLine: z.string(),
  outcome: z.enum(["passed", "failed", "could-not-run", "timed-out", "stopped"]),
  durationMs: z.int().nonnegative(),
});

/** One run of one of a Task's Stages. */
export const stageRunSchema = z.object({
  id: z.uuid(),
  /** Its place among the Task's runs, from 1. */
  number: z.int().positive(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** The Stage Thread an Agent Stage's run works in. */
  threadId: z.uuid().nullable(),
  /** How its session began; null for a run that opened none. */
  session: contextMoveSchema.nullable(),
  tokens: tokenTotalsSchema,
  /** The failure a loop went back with, which the run was briefed with. */
  carriedFailure: wentBackSchema.nullable(),
  commandRuns: z.array(stageCommandRunSchema),
  /** Null while the run goes on. */
  outcome: stageRunOutcomeSchema.nullable(),
});
export type StageRun = z.infer<typeof stageRunSchema>;

/** One of a started Task's own Stages, with its runs. */
export const taskStageSchema = z.object({
  stage: stageSchema,
  state: stageStateSchema,
  /** Every token of its runs, all four kinds, as "tokens in this Thread" counts them. */
  tokens: z.int().nonnegative(),
  /** Set when its latest run failed and its loop went back to an earlier Stage. */
  wentBack: wentBackSchema.nullable(),
  /** Oldest first. */
  runs: z.array(stageRunSchema),
});
export type TaskStage = z.infer<typeof taskStageSchema>;

/**
 * GET /tasks/:id/stages: the Task's own Stages, copied from its Pipeline as it starts; null before
 * then, while the library Pipeline's Stages are the Task's.
 */
export const taskStagesSchema = z.object({ stages: z.array(taskStageSchema).nullable() });
export type TaskStages = z.infer<typeof taskStagesSchema>;

/** Pipelines' events the web receives; each names the Task whose Stages changed. */
export const pipelinesWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("task-stages.made"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("stage-run.started"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("stage-run.ended"),
    taskId: z.uuid(),
    stageKey: z.string(),
    status: z.enum(["done", "needs-decision", "failed"]),
  }),
  webEventSchema.extend({
    type: z.literal("stage-run.skipped"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("stage-run.went-back"),
    taskId: z.uuid(),
    fromStageKey: z.string(),
    toStageKey: z.string(),
    round: z.int().positive(),
    rounds: z.int().positive(),
  }),
  webEventSchema.extend({
    type: z.literal("stage-run.budget-reached"),
    taskId: z.uuid(),
    stageKey: z.string(),
    used: z.int().nonnegative(),
    budget: z.int().nonnegative(),
  }),
  webEventSchema.extend({
    type: z.literal("stage-run.no-retries-left"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("pipeline.definition-of-done-not-met"),
    taskId: z.uuid(),
  }),
  webEventSchema.extend({ type: z.literal("pipeline.completed"), taskId: z.uuid() }),
]);
export type PipelinesWebEvent = z.infer<typeof pipelinesWebEventSchema>;
