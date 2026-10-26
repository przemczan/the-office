import { z } from "zod";
import { contextMoveSchema, tokenTotalsSchema } from "./conversations.js";
import { webEventSchema } from "./events.js";
import { effortSchema } from "./people.js";

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
    /** One of the engine's models; absent keeps the Role's. */
    model: z.string().min(1).optional(),
    /** Absent keeps the Role's. */
    effort: effortSchema.optional(),
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

/**
 * Where one of a started Task's Stages stands, from its latest run: paused and stopped when the
 * user held it, which is no failure.
 */
export const stageStateSchema = z.enum([
  "pending",
  "running",
  "waiting-on-you",
  "paused",
  "stopped",
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
    /** Set when the user stopped or paused the run, or The Office restarted during it. */
    interrupted: z.enum(["stop", "pause", "restart"]).nullable(),
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

/**
 * What the user did at a Gate: let the work continue, send it back to an earlier Agent Stage with
 * their feedback, or drop the Task.
 */
export const gateActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("continue") }),
  z.object({ kind: z.literal("send-back"), stageKey: z.string(), feedback: z.string() }),
  z.object({ kind: z.literal("drop") }),
]);
export type GateAction = z.infer<typeof gateActionSchema>;

/** POST /tasks/:id/gate/send-back: the earlier Agent Stage, and what should change. */
export const sendBackSchema = z.object({
  stageKey: z.string().min(1),
  feedback: z.string().trim().min(1, "Say what should change before sending it back."),
});
export type SendBack = z.infer<typeof sendBackSchema>;

/** What a refused Gate action answers: every reason, also joined into Nest's `message`. */
export const gateRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type GateRefusal = z.infer<typeof gateRefusalSchema>;

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
  /** The feedback a Gate sent the work back to this Stage with, which the run was briefed with. */
  sentBack: z.object({ gateKey: z.string(), feedback: z.string() }).nullable(),
  commandRuns: z.array(stageCommandRunSchema),
  /** What the user did at a Gate's run; null while the Gate waits, and for other kinds. */
  gateAction: gateActionSchema.nullable(),
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

/** How a checking Script Stage last ended by itself: a held or restarted run tells nothing of the code. */
export const testResultStateSchema = z.enum(["passed", "failed", "skipped", "not-run"]);
export type TestResultState = z.infer<typeof testResultStateSchema>;

/** The latest result of a Script Stage that checks the code (build, lint, tests). */
export const testResultSchema = z.object({
  stageKey: z.string(),
  name: z.string(),
  state: testResultStateSchema,
  /** The first line of its summary or error, in The Office's Markdown; null before it ran. */
  detail: z.string().nullable(),
});
export type TestResult = z.infer<typeof testResultSchema>;

/**
 * GET /tasks/:id/stages: the Task's own Stages, copied from its Pipeline as it starts or as the user
 * first edits them for the Task; null while the Task follows its library Pipeline. With the latest
 * result of each Stage that checks the code, in the Stages' order, as Changes shows them.
 */
export const taskStagesSchema = z.object({
  stages: z.array(taskStageSchema).nullable(),
  /** Whether the user edited them for the Task: the Pipeline's label says so. */
  editedForTask: z.boolean(),
  /** How many Stages, from the first, have started: an edit keeps them as they are, where they are. */
  lockedStages: z.int().nonnegative(),
  testResults: z.array(testResultSchema),
});
export type TaskStages = z.infer<typeof taskStagesSchema>;

/** PUT /tasks/:id/stages: the Task's Stages as the user edited them for the Task, in order. */
export const taskStagesEditSchema = z.object({ stages: z.array(stageSchema) });
export type TaskStagesEdit = z.infer<typeof taskStagesEditSchema>;

/** Why a list of Stages can't be saved, on the Stage it concerns when there is one. */
export const stageProblemSchema = z.object({
  stageIndex: z.int().nonnegative().nullable(),
  text: z.string(),
});
export type StageProblem = z.infer<typeof stageProblemSchema>;

/**
 * POST /tasks/:id/stages/check: what saving the edited Stages would be refused for, so the editor
 * flags it before Save; empty when they can be saved.
 */
export const stagesCheckSchema = z.object({ problems: z.array(stageProblemSchema) });
export type StagesCheck = z.infer<typeof stagesCheckSchema>;

/**
 * 422 from PUT /tasks/:id/stages: every reason the edit can't be saved, as words like every refusal's
 * and on the Stage each concerns.
 */
export const stagesEditRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
  problems: z.array(stageProblemSchema).min(1),
});
export type StagesEditRefusal = z.infer<typeof stagesEditRefusalSchema>;

/** Pipelines' events the web receives; each names the Task whose Stages changed. */
export const pipelinesWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("task-stages.made"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task-stages.edited"), taskId: z.uuid() }),
  /** The Pipeline was swapped before Start: the Task follows the library again. */
  webEventSchema.extend({ type: z.literal("task-stages.reset"), taskId: z.uuid() }),
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
  /** The user stopped a run that couldn't be interrupted, such as a command: held after it. */
  webEventSchema.extend({
    type: z.literal("stage-run.stop-held-as-pause"),
    taskId: z.uuid(),
    stageKey: z.string(),
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
  webEventSchema.extend({
    type: z.literal("gate.reached"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("gate.continued"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("gate.sent-back"),
    taskId: z.uuid(),
    fromStageKey: z.string(),
    toStageKey: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("gate.dropped"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
]);
export type PipelinesWebEvent = z.infer<typeof pipelinesWebEventSchema>;
