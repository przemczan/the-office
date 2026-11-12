import { z } from "zod";
import { contextMoveSchema, tokenTotalsSchema } from "./conversations.js";
import { webEventSchema } from "./events.js";
import { stageSchema } from "./stages.js";

export const pipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  stages: z.array(stageSchema),
});
export type Pipeline = z.infer<typeof pipelineSchema>;

export const pipelineListSchema = z.array(pipelineSchema);

/** PUT /pipelines/:id: a library Pipeline as the user edited it; its id stays. */
export const pipelineEditSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  stages: z.array(stageSchema),
});
export type PipelineEdit = z.infer<typeof pipelineEditSchema>;

/** POST /pipelines: a Pipeline made from scratch, or a copy of a library Pipeline by its id. */
export const newPipelineSchema = z.union([
  pipelineEditSchema,
  z.strictObject({ copyOf: z.string().min(1) }),
]);
export type NewPipeline = z.infer<typeof newPipelineSchema>;

/** GET /pipelines/:id/use: who uses a library Pipeline, which removing it would leave without one. */
export const pipelineUseSchema = z.object({
  /** The Projects that name it as their default, by name. */
  defaultFor: z.array(z.object({ projectId: z.string(), name: z.string() })),
  /** Tasks that haven't started: saving the Pipeline changes those that follow it. */
  notStarted: z.int().nonnegative(),
  /** Started Tasks still at work, which keep the copy they started with. */
  running: z.int().nonnegative(),
  /** Shaping or active Initiatives that name it as the Initiative's Pipeline. */
  initiatives: z.int().nonnegative(),
});
export type PipelineUse = z.infer<typeof pipelineUseSchema>;

/** 422 from DELETE /pipelines/:id: every reason the Pipeline can't be removed now. */
export const pipelineRemovalRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type PipelineRemovalRefusal = z.infer<typeof pipelineRemovalRefusalSchema>;

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
    /**
     * The Definition of Done statements this run's Agent reported met, by their numbers from 1; null
     * for a run that reports none, such as a Script Stage's. What stands for the Task is
     * `TaskStages.definitionOfDoneMet`.
     */
    definitionOfDoneMet: z.array(z.int().positive()).nullable(),
    /** The pull request a Publish opened; null for any other run, and a Publish before it was kept. */
    pullRequestUrl: z.url().nullable(),
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
    /**
     * Set when the user stopped or paused the run, the fire alarm held it, or The Office restarted
     * during it.
     */
    interrupted: z.enum(["stop", "pause", "alarm", "restart"]).nullable(),
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
 * GET /tasks/:id/stage-runs/:runId/command-outputs: what each of the run's commands printed, in the
 * order of its `commandRuns`, read apart from the Stages as it can be 64 KB each.
 */
export const stageRunCommandOutputsSchema = z.object({ outputs: z.array(z.string()) });
export type StageRunCommandOutputs = z.infer<typeof stageRunCommandOutputsSchema>;

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
  /**
   * Since when a Script Stage's run waits for a free run environment, before its command starts;
   * null while it doesn't.
   */
  waitingSince: z.iso.datetime().nullable(),
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
  /** Every token of its runs, by kind. */
  tokens: tokenTotalsSchema,
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
  /**
   * The Definition of Done statements Reported met, by their numbers from 1: the walk's own rule over
   * all the Task's runs, so a later run can take one back.
   */
  definitionOfDoneMet: z.array(z.int().positive()),
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
 * POST /pipelines/check: a library Pipeline as the editor holds it; `pipelineId` names the one being
 * saved, so its own name isn't taken, and is absent for a new one.
 */
export const pipelineCheckRequestSchema = pipelineEditSchema.extend({
  pipelineId: z.string().min(1).optional(),
});
export type PipelineCheckRequest = z.infer<typeof pipelineCheckRequestSchema>;

/**
 * What saving a library Pipeline would be refused for, and what the editor flags but saves: an
 * Agent Stage whose Role nobody fills, which pauses a Task that reaches it.
 */
export const pipelineCheckSchema = z.object({
  problems: z.array(stageProblemSchema),
  flags: z.array(stageProblemSchema),
});
export type PipelineCheck = z.infer<typeof pipelineCheckSchema>;

/**
 * A Stage template (spec §2.3): a Stage kept in the Pipeline library to add to a Pipeline or a
 * Task's Stages as a copy. Its name is its Stage's; it never has `onFailure`, which only a Pipeline
 * gives meaning.
 */
export const stageTemplateSchema = z.object({ id: z.string().min(1), stage: stageSchema });
export type StageTemplate = z.infer<typeof stageTemplateSchema>;

export const stageTemplateListSchema = z.array(stageTemplateSchema);

/**
 * POST /stage-templates and PUT /stage-templates/:id: the template's Stage as the user edited it,
 * or a Stage saved as a template; an `onFailure` in it is dropped.
 */
export const stageTemplateEditSchema = z.strictObject({ stage: stageSchema });
export type StageTemplateEdit = z.infer<typeof stageTemplateEditSchema>;

/**
 * POST /stage-templates/check: a template as the editor holds it; `stageTemplateId` names the one
 * being saved, so its own name isn't taken, and is absent for a new one. It answers a
 * `pipelineCheckSchema`: what a save would be refused for, and the Role flags it saves anyway.
 */
export const stageTemplateCheckRequestSchema = stageTemplateEditSchema.extend({
  stageTemplateId: z.string().min(1).optional(),
});
export type StageTemplateCheckRequest = z.infer<typeof stageTemplateCheckRequestSchema>;

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

/**
 * Pipelines' events the web receives: the library's name the Pipeline or the Stage template, the
 * others the Task whose Stages changed.
 */
export const pipelinesWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("pipeline.added"), pipelineId: z.string() }),
  webEventSchema.extend({ type: z.literal("pipeline.saved"), pipelineId: z.string() }),
  webEventSchema.extend({ type: z.literal("pipeline.removed"), pipelineId: z.string() }),
  webEventSchema.extend({ type: z.literal("stage-template.added"), stageTemplateId: z.string() }),
  webEventSchema.extend({ type: z.literal("stage-template.saved"), stageTemplateId: z.string() }),
  webEventSchema.extend({
    type: z.literal("stage-template.removed"),
    stageTemplateId: z.string(),
  }),
  webEventSchema.extend({ type: z.literal("task-stages.made"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task-stages.edited"), taskId: z.uuid() }),
  /** The Pipeline was swapped before Start: the Task follows the library again. */
  webEventSchema.extend({ type: z.literal("task-stages.reset"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("stage-run.started"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
  /** Saved after the run started, so what shows a running run reads it again for its Thread. */
  webEventSchema.extend({
    type: z.literal("stage-run.thread-opened"),
    taskId: z.uuid(),
    stageKey: z.string(),
  }),
  /** A Script Stage's run began or stopped waiting for a free run environment. */
  webEventSchema.extend({
    type: z.literal("stage-run.waiting"),
    taskId: z.uuid(),
    stageKey: z.string(),
    waiting: z.boolean(),
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
