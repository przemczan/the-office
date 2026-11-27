import { z } from "zod";
import { contextMoveSchema, tokenTotalsSchema } from "./conversations.js";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";
import {
  publishResultSchema,
  stagePositionSchema,
  stageProblemSchema,
  stageSchema,
} from "./stages.js";
import { dropSchema } from "./work.js";

/** Where End stands on the flow editor's canvas; absent, right of the right-most Stage. */
const endPositionField = { endPosition: stagePositionSchema.optional() };

export const pipelineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  stages: z.array(stageSchema),
  ...endPositionField,
});
export type Pipeline = z.infer<typeof pipelineSchema>;

export const pipelineListSchema = z.array(pipelineSchema);

/** GET /pipelines and GET /pipelines/:id: an office-wide Pipeline. */
export const officeWidePipelineSchema = pipelineSchema;
export type OfficeWidePipeline = z.infer<typeof officeWidePipelineSchema>;

export const officeWidePipelineListSchema = z.array(officeWidePipelineSchema);

/** PUT /pipelines/:id: a library Pipeline as the user edited it; its id stays. */
export const pipelineEditSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  stages: z.array(stageSchema),
  ...endPositionField,
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

/** 422 from DELETE /pipelines/:id and /project-pipelines/:id: every reason it can't be removed now. */
export const pipelineRemovalRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type PipelineRemovalRefusal = z.infer<typeof pipelineRemovalRefusalSchema>;

/**
 * Where one of a started Task's Stages stands, from its latest run: paused and stopped when the
 * user held it, which is no failure; not taken when it has no run and no path of routes leads to
 * it from the Stage of the Task's latest run, as the walk went another way.
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
  "not-taken",
]);
export type StageState = z.infer<typeof stageStateSchema>;

/**
 * A failure route back: the Stage it went back to, and which time of how many its limit allows,
 * with the times answers allowed past it; `rounds` null for a route with No limit.
 */
export const wentBackSchema = z.object({
  stageKey: z.string(),
  round: z.int().positive(),
  rounds: z.int().positive().nullable(),
});
export type WentBack = z.infer<typeof wentBackSchema>;

const handoverNoteField = { handoverNote: z.string().nullable() };

/** What a Publish shipped by the publishing mode: a pull request opened, or a merge. */
export const publishedWorkSchema = z.object({
  kind: z.enum(["pull-request-opened", "merged"]),
  branch: z.string(),
  /** The commit that shipped: after a merge, the merged one. */
  commit: z.string(),
  pullRequestUrl: z.url().nullable(),
});
export type PublishedWork = z.infer<typeof publishedWorkSchema>;

/** How a Stage run ended, with its Agent's Handover note when it wrote one. */
export const stageRunOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("done"),
    summary: z.string(),
    /** A Stage skipped, which ran nothing, as the previous release recorded optional Stages. */
    skipped: z.boolean(),
    /**
     * The Definition of Done statements this run's Agent reported met, by their numbers from 1; null
     * for a run that reports none, such as a Script Stage's. What stands for the Task is
     * `TaskStages.definitionOfDoneMet`.
     */
    definitionOfDoneMet: z.array(z.int().positive()).nullable(),
    /** The pull request a Publish opened; null for any other run, and a Publish before it was kept. */
    pullRequestUrl: z.url().nullable(),
    /** A Publish Stage's run's result; null for any other run. */
    publishResult: publishResultSchema.nullable(),
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
    interrupted: z.enum(["stop", "pause", "alarm", "restart", "usage-window"]).nullable(),
    /**
     * Set on a run held as its engine refused a turn for a used-up usage window: the window, its
     * reset, and whether the refused turn left a session for the Stage to go on in (else Resume
     * begins a fresh one with the full brief).
     */
    refusedTurn: z
      .object({
        engineName: z.string(),
        windowWords: z.string(),
        resetsAt: z.iso.datetime(),
        sessionLeft: z.boolean(),
        /**
         * Set when a Stand-in Engine had room but the session's context was over the size
         * Settings › Engines asks first above: the Task waits Paused for the user's choice of going
         * on there, or the reset.
         */
        standInChoice: z
          .object({
            engineId: z.string(),
            engineName: z.string(),
            contextTokens: z.int().nonnegative(),
            askAbove: z.int().nonnegative(),
          })
          .nullable(),
      })
      .nullable(),
    /**
     * Set on a Publish run that shipped the work but whose after publishing line failed: the work
     * did ship, so this is no plain failure.
     */
    afterPublishingFailed: publishedWorkSchema.nullable(),
    /** A Publish Stage's run's result (Conflict, After publishing failed or Failed); null otherwise. */
    publishResult: publishResultSchema.nullable(),
    ...handoverNoteField,
  }),
]);
export type StageRunOutcome = z.infer<typeof stageRunOutcomeSchema>;

/** A Project command The Office ran for a Stage run. */
export const stageCommandRunSchema = z.object({
  /**
   * The install before the Stage, the Script Stage's command, a failing test's re-run, a Publish's
   * before or after publishing line, or the command a condition of the Stage's routes out names.
   */
  purpose: z.enum([
    "install",
    "command",
    "re-run",
    "before-publishing",
    "after-publishing",
    "condition",
  ]),
  commandLine: z.string(),
  outcome: z.enum(["passed", "failed", "could-not-run", "timed-out", "stopped"]),
  durationMs: z.int().nonnegative(),
  /**
   * The route a condition command, or the install before it, was run for: the key of the Stage it
   * leads to, or null for End. Absent for any other command.
   */
  condition: z.object({ to: z.string().nullable() }).optional(),
});

/**
 * GET /tasks/:id/stage-runs/:runId/command-outputs: what each of the run's commands printed, in the
 * order of its `commandRuns`, read apart from the Stages as it can be 64 KB each.
 */
export const stageRunCommandOutputsSchema = z.object({ outputs: z.array(z.string()) });
export type StageRunCommandOutputs = z.infer<typeof stageRunCommandOutputsSchema>;

/**
 * The person who acted at a Gate by their Office tool: the Role they fill, the user who asked them
 * and, for a call held for approval, the user who allowed it, each by their name then.
 */
export const gatePersonSchema = z.object({
  roleKey: z.string(),
  askedBy: z.string(),
  allowedBy: z.string().optional(),
});
export type GatePerson = z.infer<typeof gatePersonSchema>;

/**
 * What the user did at a Gate: let the work continue, with notes for the Agent Stages after it or
 * none, send it back to an earlier Agent Stage with their feedback, or drop the Task. `person` is
 * set when a person acted for the user, by their Office tool.
 */
export const gateActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("continue"),
    feedback: z.string().optional(),
    person: gatePersonSchema.optional(),
  }),
  z.object({
    kind: z.literal("send-back"),
    stageKey: z.string(),
    feedback: z.string(),
    person: gatePersonSchema.optional(),
  }),
  z.object({ kind: z.literal("drop"), person: gatePersonSchema.optional() }),
]);
export type GateAction = z.infer<typeof gateActionSchema>;

/**
 * POST /tasks/:id/gate/continue: optional notes for the Agent Stages after the Gate. No body, or
 * blank notes, is plain Continue.
 */
export const continueAtGateSchema = z.object({ feedback: z.string().optional() });
export type ContinueAtGate = z.infer<typeof continueAtGateSchema>;

/** POST /tasks/:id/gate/send-back: the earlier Agent Stage, and what should change. */
export const sendBackSchema = z.object({
  stageKey: z.string().min(1),
  feedback: z.string().trim().min(1, "Say what should change before sending it back."),
});
export type SendBack = z.infer<typeof sendBackSchema>;

/**
 * POST /tasks/:id/restart, Restart from… a Task the user paused or stopped: any Stage of its
 * Pipeline, later ones too, with optional feedback. The held run ends, its uncommitted edits
 * discarded, and the Task goes on In progress from that Stage. Answers an empty object.
 */
export const taskRestartSchema = z.object({
  stageKey: z.string().min(1),
  feedback: z.string().trim().optional(),
});
export type TaskRestart = z.infer<typeof taskRestartSchema>;

/** Office action: Restart from… a Task the user paused or stopped. */
export const RESTART_TASK_FROM_ACTION = officeAction({
  name: "restart_task_from",
  title: "Restart a Task from a Stage",
  description:
    "Restarts a Paused Task from a Stage of its Pipeline, later ones too, with optional feedback: the held run ends, its uncommitted edits are discarded, and the Task goes on In progress from that Stage.",
  input: z.object({
    taskId: z.uuid().describe("The id of the Task."),
    stageKey: z.string().min(1).describe("The key of the Stage the Task goes on from."),
    feedback: z.string().trim().optional().describe("Feedback to brief the Stage with."),
  }),
  answer: z.object({}),
  route: { method: "POST", path: "/tasks/:taskId/restart" },
  area: "work",
  group: "gatesAndRuns",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** What a refused Gate action answers: every reason, also joined into Nest's `message`. */
export const gateRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type GateRefusal = z.infer<typeof gateRefusalSchema>;

/**
 * The engine and model a run's session ran on, with the engine's name at the time; `standInFor`
 * names the cascade's engine it stood in for as a Stand-in Engine, and why, null on the cascade's.
 */
export const stageRunEngineSchema = z.object({
  engineId: z.string(),
  engineName: z.string(),
  model: z.string(),
  standInFor: z
    .object({ engineId: z.string(), engineName: z.string(), reason: z.string() })
    .nullable(),
});
export type StageRunEngine = z.infer<typeof stageRunEngineSchema>;

/**
 * A run's session moved to a Stand-in Engine as its engine refused a turn for a used-up usage
 * window, each engine with its name at the time.
 */
export const engineSwitchSchema = z.object({
  fromEngineId: z.string(),
  fromEngineName: z.string(),
  toEngineId: z.string(),
  toEngineName: z.string(),
  /** The used-up window as the user reads it, such as "5-hour window". */
  windowWords: z.string(),
  resetsAt: z.iso.datetime(),
  at: z.iso.datetime(),
  /**
   * The user who chose the switch for a run held waiting for their choice; null for a switch The
   * Office made by itself.
   */
  chosenBy: z.object({ userId: z.string(), name: z.string() }).nullable(),
});
export type EngineSwitch = z.infer<typeof engineSwitchSchema>;

/**
 * A Stage held as its engine's usage window was used up, whose context is over the size Settings ›
 * Engines asks first above, waiting for the user's choice of going on on a Stand-in Engine now or
 * waiting for the reset (spec 5.4): a row of The Office's own Decision in Needs you.
 */
export const standInChoiceSchema = z.object({
  /** The held run, by which the user switches it. */
  runId: z.uuid(),
  taskId: z.uuid(),
  taskTitle: z.string(),
  projectId: z.string(),
  stageKey: z.string(),
  stageName: z.string(),
  /** The engine whose usage window was used up, by its name at the time, and its reset. */
  engineName: z.string(),
  resetsAt: z.iso.datetime(),
  /** The session's context when its turn was refused, in tokens. */
  contextTokens: z.int().nonnegative(),
  /** The size above which Settings › Engines asks before a switch, in tokens. */
  askAbove: z.int().nonnegative(),
  /**
   * The Stand-in Engine it would move to now, the first with room, by its id and name; null while
   * none has room.
   */
  standIn: z.object({ engineId: z.string(), engineName: z.string() }).nullable(),
  /** Since when it waits: the held run's end. */
  waitingSince: z.iso.datetime(),
});
export type StandInChoice = z.infer<typeof standInChoiceSchema>;

export const standInChoicesResponseSchema = z.object({ choices: z.array(standInChoiceSchema) });
export type StandInChoicesResponse = z.infer<typeof standInChoicesResponseSchema>;

/** The held runs the user switches now, each Task on its own (`POST /stand-in-choices/switch`). */
export const standInSwitchRequestSchema = z.object({ runIds: z.array(z.uuid()).min(1) });
export type StandInSwitchRequest = z.infer<typeof standInSwitchRequestSchema>;

/**
 * What came of one held run's switch: moved and resumed (`switched`); it no longer waits, as its
 * Task resumed by itself at the reset (`already-resumed`) or was resumed, stopped or dropped by
 * hand (`no-longer-waiting`); no Stand-in Engine had room (`no-room`); the move failed (`failed`),
 * the Task staying Paused on its own Engine; or the session moved but the Task couldn't resume
 * (`moved-not-resumed`), so it waits for the user's Resume.
 */
export const standInSwitchOutcomeSchema = z.enum([
  "switched",
  "already-resumed",
  "no-longer-waiting",
  "no-room",
  "failed",
  "moved-not-resumed",
]);
export type StandInSwitchOutcome = z.infer<typeof standInSwitchOutcomeSchema>;

export const standInSwitchResultSchema = z.object({
  runId: z.uuid(),
  outcome: standInSwitchOutcomeSchema,
  /** What happened, as the card shows it beside the Stage. */
  words: z.string(),
});
export type StandInSwitchResult = z.infer<typeof standInSwitchResultSchema>;

export const standInSwitchResponseSchema = z.object({
  results: z.array(standInSwitchResultSchema),
});
export type StandInSwitchResponse = z.infer<typeof standInSwitchResponseSchema>;

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
  /** What its session ran on; null for a run that opened none, and for runs kept before it was. */
  engine: stageRunEngineSchema.nullable(),
  /**
   * Each move of its session to a Stand-in Engine during the run, in order (`engine` is the last
   * one's); none for a run that stayed on one engine.
   */
  engineSwitches: z.array(engineSwitchSchema),
  tokens: tokenTotalsSchema,
  /**
   * Its session's context after the run's latest turn, against its model's window, kept with the
   * run; null for a run that read none.
   */
  context: z
    .object({
      contextTokens: z.int().nonnegative(),
      contextWindow: z.int().positive(),
    })
    .nullable(),
  /** The failure a failure route carried to the run, which the run was briefed with. */
  carriedFailure: wentBackSchema.nullable(),
  /**
   * The route the walk left the run by (spec §2.3, "Which route the walk follows"): where it leads
   * (`to`, a Stage's key or null for End), the times the walk followed it so far, this one
   * included, and the times it may, its limit with those answers allowed past it, null for No
   * limit. Null until a later run started, and for a run left by no route.
   */
  route: z
    .object({
      to: z.string().nullable(),
      times: z.int().positive(),
      limit: z.int().positive().nullable(),
    })
    .nullable(),
  /**
   * The route an Agent Stage's Agent chose with `choose_route` (spec §2.3, "How an Agent chooses
   * its route"): its target (`to`, a Stage's key or null for End, with `toName` the Stage's name or
   * "End") and the Agent's reason; null when it chose none.
   */
  choice: z
    .object({ to: z.string().nullable(), toName: z.string(), reason: z.string() })
    .nullable(),
  /** The feedback a Gate sent the work back to this Stage with, which the run was briefed with. */
  sentBack: z.object({ gateKey: z.string(), feedback: z.string() }).nullable(),
  /**
   * The user's Restart from… on this held run: the Stage the walk went on from, by key, the
   * feedback given (null for none) and who restarted it, by their name then.
   */
  restart: z
    .object({ stageKey: z.string(), feedback: z.string().nullable(), by: z.string() })
    .nullable(),
  /**
   * The feedback of the Restart from… that ran this run, null when none was given, which an Agent
   * Stage's run was briefed with; null for a run no restart ran.
   */
  restarted: z.object({ feedback: z.string().nullable(), by: z.string() }).nullable(),
  /**
   * The user's Start over after this run, the last before it: who, when, and with the branch reset,
   * the branch it was reset to and the local ref keeping the old head; null otherwise.
   */
  startedOver: z
    .object({
      by: z.string(),
      at: z.iso.datetime(),
      resetTo: z.string().nullable(),
      keptRef: z.string().nullable(),
    })
    .nullable(),
  /**
   * Whether the run is of an earlier start, before the latest Start over: kept as history only, the
   * walk, the rail and Reported met ignore it.
   */
  earlierStart: z.boolean(),
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
  /** Set when its latest run failed and its failure route carried the failure to a Stage. */
  wentBack: wentBackSchema.nullable(),
  /**
   * Only for an Agent Stage naming a duty: the key of the Role working it, its latest run's once
   * started, the duty's holder before; null while nobody holds it.
   */
  workedBy: z.string().nullable().optional(),
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
  ...endPositionField,
  /**
   * The Definition of Done statements Reported met, by their numbers from 1: the walk's own rule over
   * all the Task's runs: met once any Agent Stage reported it, until a later report takes it back.
   */
  definitionOfDoneMet: z.array(z.int().positive()),
  /**
   * The statements not Reported met that an Agent reported Out of reach, by their numbers from 1,
   * each with its latest why.
   */
  definitionOfDoneOutOfReach: z.array(z.object({ statement: z.int().positive(), why: z.string() })),
  /**
   * The keys of the Gates that are the Definition of Done check for the Publish after them, as no
   * Agent Stage stands between: Continue there calls it met (spec §2.3).
   */
  gatesCheckingDefinitionOfDone: z.array(z.string()),
  /** Whether the user edited them for the Task: the Pipeline's label says so. */
  editedForTask: z.boolean(),
  /** How many Stages, from the first, have started: an edit keeps them as they are, where they are. */
  lockedStages: z.int().nonnegative(),
  testResults: z.array(testResultSchema),
});
export type TaskStages = z.infer<typeof taskStagesSchema>;

/** PUT /tasks/:id/stages: the Task's Stages as the user edited them for the Task, in order. */
export const taskStagesEditSchema = z.object({
  stages: z.array(stageSchema),
  ...endPositionField,
});
export type TaskStagesEdit = z.infer<typeof taskStagesEditSchema>;

/** Office action: Edit for this Task, the Task's own Stages replaced. */
export const EDIT_TASK_STAGES_ACTION = officeAction({
  name: "edit_task_stages",
  title: "Edit a Task's Stages",
  description:
    "Replaces a Task's own Stages, in order, with the end position if any: the library Pipeline is left as it is. The Stages that have started stay as they are, where they are; refused with every problem the Stages have.",
  input: taskStagesEditSchema.extend({ taskId: z.uuid().describe("The id of the Task.") }),
  answer: taskStagesSchema,
  route: { method: "PUT", path: "/tasks/:taskId/stages" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Switch now, the held runs moved to a Stand-in Engine. */
export const SWITCH_TO_STAND_IN_ACTION = officeAction({
  name: "switch_to_stand_in",
  title: "Switch to the stand-in",
  description:
    "Switches held runs now to a Stand-in Engine, each Task on its own, instead of waiting for the usage window to reset; answers a result for each run.",
  input: standInSwitchRequestSchema,
  answer: standInSwitchResponseSchema,
  route: { method: "POST", path: "/stand-in-choices/switch" },
  area: "work",
  group: "movingWork",
  // The batch is ruled by its first run.
  subject: ({ runIds }) => ({ kind: "stage-run", id: runIds[0] as string }),
});

/** Office action: Continue at a Gate, the work goes on to the Stage after it. */
export const CONTINUE_AT_GATE_ACTION = officeAction({
  name: "continue_at_gate",
  title: "Continue at a Gate",
  description:
    "Continues a Task waiting at a Gate: the work goes on to the Stage after the Gate, with optional notes every later Agent Stage is briefed with. On a Task you created or worked a Stage of, it is ruled by your Authority for Continue at a Gate on own work, which always needs the user's approval.",
  input: z.object({
    taskId: z.uuid().describe("The id of the Task."),
    feedback: continueAtGateSchema.shape.feedback.describe("Notes for the later Agent Stages."),
  }),
  answer: taskStagesSchema,
  route: { method: "POST", path: "/tasks/:taskId/gate/continue" },
  area: "work",
  group: "gatesAndRuns",
  onOwnWork: "continueAtGateOnOwnWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Send back at a Gate, an earlier Agent Stage runs again with the feedback. */
export const SEND_BACK_AT_GATE_ACTION = officeAction({
  name: "send_back_at_gate",
  title: "Send back at a Gate",
  description:
    "Sends a Task waiting at a Gate back to an earlier Agent Stage, which runs again with your feedback; it uses no round of any loop.",
  input: z.object({
    taskId: z.uuid().describe("The id of the Task."),
    stageKey: sendBackSchema.shape.stageKey.describe("The key of the earlier Agent Stage."),
    feedback: sendBackSchema.shape.feedback.describe("What should change."),
  }),
  answer: taskStagesSchema,
  route: { method: "POST", path: "/tasks/:taskId/gate/send-back" },
  area: "work",
  group: "gatesAndRuns",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Drop at a Gate. */
export const DROP_AT_GATE_ACTION = officeAction({
  name: "drop_at_gate",
  title: "Drop at a Gate",
  description: "Drops a Task waiting at a Gate, with the reason you give, if any.",
  input: z.object({
    taskId: z.uuid().describe("The id of the Task."),
    reason: dropSchema.shape.reason.describe("Why the Task is dropped."),
  }),
  answer: taskStagesSchema,
  route: { method: "POST", path: "/tasks/:taskId/gate/drop" },
  area: "work",
  group: "gatesAndRuns",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/**
 * POST /tasks/:id/stages/check: the Stages as the editor holds them, and `pipelineId`, the Pipeline
 * the draft follows when it isn't the Task's own yet, as one chosen or swapped to before Save.
 */
export const stagesCheckRequestSchema = taskStagesEditSchema.extend({
  pipelineId: z.string().min(1).optional(),
});
export type StagesCheckRequest = z.infer<typeof stagesCheckRequestSchema>;

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
 * What saving a library Pipeline would be refused for, and what the editor warns about but saves,
 * in one list by level: an Agent Stage whose Role nobody fills, which pauses a Task that reaches it,
 * or a Stage whose routes all carry a condition. A Project Pipeline's check answers the same.
 */
export const pipelineCheckSchema = z.object({
  problems: z.array(stageProblemSchema),
});
export type PipelineCheck = z.infer<typeof pipelineCheckSchema>;

/**
 * GET /pipelines/library/needs-fixing: the library Pipelines whose saved Stages their own check would
 * list a problem or a warning for, the list's "Needs fixing" flag, in one answer for the whole library.
 * GET /project-pipelines/check/needs-fixing?projectId= answers the same for a Project's own, one
 * Broken before The Office updated and not saved since among them.
 */
export const pipelinesNeedingFixingSchema = z.object({
  pipelineIds: z.array(z.string()),
});
export type PipelinesNeedingFixing = z.infer<typeof pipelinesNeedingFixingSchema>;

/**
 * GET /project-pipelines/:id: a Project Pipeline (spec §2.3.5), a full Pipeline of its Project, with
 * the name of the Pipeline it was copied from and when (null for one the update moved), and why it
 * was Broken before The Office updated, null when it wasn't or once it was saved.
 */
export const projectPipelineSchema = pipelineSchema.extend({
  projectId: z.string().min(1),
  copiedFrom: z.object({ name: z.string(), at: z.iso.datetime().nullable() }),
  brokenBeforeUpdate: z.array(z.string()).nullable(),
});
export type ProjectPipeline = z.infer<typeof projectPipelineSchema>;

/** GET /project-pipelines?projectId=: a Project's Project Pipelines, or every Project's. */
export const projectPipelineListSchema = z.array(projectPipelineSchema);

/** PUT /project-pipelines/:id: a Project Pipeline as the user edited it; its id and Project stay. */
export const projectPipelineEditSchema = pipelineEditSchema;
export type ProjectPipelineEdit = z.infer<typeof projectPipelineEditSchema>;

/**
 * POST /project-pipelines: a new Project Pipeline of the Project, a copy of `copyOf`'s Stages as
 * they are: an office-wide Pipeline's, never Onboard, or one of the Project's own.
 */
export const newProjectPipelineSchema = z.strictObject({
  projectId: z.string().min(1),
  copyOf: z.string().min(1),
  name: z.string(),
  description: z.string(),
});
export type NewProjectPipeline = z.infer<typeof newProjectPipelineSchema>;

/**
 * How a Pipeline's Stages, routes and positions are given, which the Pipeline actions' tool
 * descriptions share (an Agent reads `list_pipelines` for the shape, and here for the rules).
 */
const PIPELINE_STAGES_WORDS =
  "Give all of the Stages, in the Pipeline's order, in the shape list_pipelines gives them, and read it first: the first Stage is where every walk starts. A Stage's `kind` is \"agent\", \"script\", \"gate\" or \"publish\". An Agent Stage with `mergeBaseFirst` true has The Office merge the base into the Task's branch as it starts, leaving conflicts for its Agent. A Script Stage's command is a Project command by its key, never install or publish. A Publish Stage publishes by the Project's publishing mode, or with `publishTarget` \"branch-only\" pushes the branch only. A Stage's `position` (`x`, `y`) is where its card's top-left corner stands on the editor's canvas (a card is 232 wide and 72 to about 170 high; leave 76 between Stages side by side); it is layout alone. Leave every position out to have the Stages stand in a row; `endPosition` places End, right of the last Stage when left out. `place` (column, row) is from before free placement and is refused. Stages that all leave their routes out are taken as a straight line, each to the next. Every Project with the Pipeline as default, or with a Task on it that hasn't started, must have each key it names, a command test's among them.";

const PIPELINE_ROUTES_WORDS =
  'Each Stage\'s routes are weighed in order and the walk follows the first whose condition holds: a route leads to any Stage by its key (`to`), its own and earlier ones included, or to End with `to` null; a condition null always holds, so the last route usually carries none. A condition is a group, `combine` "all" or "any", of tests and nested groups: a Stage test `{ "kind": "stage", "stage": <key, or null for the route\'s own>, "is": … }` of that Stage\'s latest run, `is` being "done", "failed", "skipped", "changed" (changed files), "unchanged", or "ran" with `times`, and for a Publish Stage alone "published", "nothing-to-publish", "conflict" or "after-publishing-failed"; a Definition of Done test `{ "kind": "definitionOfDone", "is": "all-met" | "some-not-met" }`; or a Project command test `{ "kind": "command", "key": <the Project\'s command key> }`, which holds when that command exits 0. A route\'s `limit` is the most times the walk follows it in one walk, 1 to 9, or null for No limit; left out it is 3 for a route back (to its own Stage or an earlier one) and No limit for a route on; a route at its limit stops the walk and asks, and every loop must pass through a route with a limit. A Stage\'s failure goes on only by a failure route, `{ "combine": "all", "tests": [{ "kind": "stage", "stage": null, "is": "failed" }] }` placed first among its routes, usually back to the Stage that fixes the work; with none, a failed Stage asks. An Agent Stage\'s route may be one of its Agent\'s choices, the only test of its route, in plain words: `{ "combine": "all", "tests": [{ "kind": "choice", "words": "the review found something to fix" }] }`, each different; the walk follows it when the Agent chose it with choose_route and the Stage ended done, so put an Otherwise (condition null) last. A Publish Stage\'s routes each take one or more of its results, each result leading to one place at most; its Conflict route leads to a conflict chain before it: Resolve (an Agent Stage with `mergeBaseFirst`), then a Script Stage running test that goes back to Resolve when it fails, then the Publish again. For example, "run Review only when Tests changed files or failed, otherwise Publish" gives Tests the routes `[{ "to": "review", "condition": { "combine": "any", "tests": [{ "kind": "stage", "stage": null, "is": "changed" }, { "kind": "stage", "stage": null, "is": "failed" }] } }, { "to": "publish", "condition": null }]`, Review `[{ "to": "publish", "condition": null }]` and Publish `[{ "to": null, "condition": null }]`.';

const PIPELINE_CHECKED_WORDS =
  "The editor's check runs on it: a flow that breaks a rule is refused with every problem, each naming its Stage and the rule, for you to fix and try again.";

const STAGE_TEMPLATE_WORDS =
  'A template\'s Stage is given whole, in the shape list_stage_templates gives it, with `kind` "agent", "script", "gate" or "publish" and the kind\'s own fields; a template keeps no routes or position, which only a Pipeline gives meaning.';

const projectPipelineIdInput = z.string().min(1).describe("The id of the Project Pipeline.");

/** Office action: a Project Pipeline made as a copy. */
export const CREATE_PROJECT_PIPELINE_ACTION = officeAction({
  name: "create_project_pipeline",
  title: "Create a Project Pipeline",
  description:
    "Makes a Project Pipeline of the Project as a copy of the Stages of an office-wide Pipeline (never Onboard) or of one of the Project's own, under a name unique among the office-wide Pipelines and the Project's own; change its flow after with change_project_pipeline. It never sets the Project's Default Pipeline.",
  input: z.strictObject({
    projectId: z.string().min(1).describe("The id of the Project."),
    copyOf: newProjectPipelineSchema.shape.copyOf.describe("The id of the Pipeline to copy."),
    name: newProjectPipelineSchema.shape.name.describe("The new Pipeline's name."),
    description: newProjectPipelineSchema.shape.description.describe("What it is for."),
  }),
  answer: projectPipelineSchema,
  route: { method: "POST", path: "/project-pipelines" },
  status: 201,
  area: "projectsAndSettings",
  group: "projectSettings",
  subject: ({ projectId }) => ({ kind: "project", id: projectId }),
});

/** Office action: a Project Pipeline saved as edited. */
export const CHANGE_PROJECT_PIPELINE_ACTION = officeAction({
  name: "change_project_pipeline",
  title: "Change a Project Pipeline",
  description: `Saves a Project Pipeline as given: its name, description, Stages and routes whole, replacing what it has; read it first with list_pipelines. Refused with every problem its Stages have; its id and Project stay. It never sets the Project's Default Pipeline. ${PIPELINE_STAGES_WORDS} ${PIPELINE_ROUTES_WORDS} ${PIPELINE_CHECKED_WORDS}`,
  input: projectPipelineEditSchema.extend({ pipelineId: projectPipelineIdInput }),
  answer: projectPipelineSchema,
  route: { method: "PUT", path: "/project-pipelines/:pipelineId" },
  area: "projectsAndSettings",
  group: "projectSettings",
  subject: ({ pipelineId }) => ({ kind: "pipeline", id: pipelineId }),
});

/** Office action: a Project Pipeline deleted. */
export const DELETE_PROJECT_PIPELINE_ACTION = officeAction({
  name: "delete_project_pipeline",
  title: "Delete a Project Pipeline",
  description:
    "Deletes a Project Pipeline. Refused while the Project's Default Pipeline or a Task that hasn't ended uses it.",
  input: z.object({ pipelineId: projectPipelineIdInput }),
  answer: z.void(),
  route: { method: "DELETE", path: "/project-pipelines/:pipelineId" },
  status: 204,
  area: "projectsAndSettings",
  group: "projectSettings",
  subject: ({ pipelineId }) => ({ kind: "pipeline", id: pipelineId }),
});

/** POST /project-pipelines/check: a Project Pipeline as the editor holds it, by its id. */
export const projectPipelineCheckRequestSchema = projectPipelineEditSchema.extend({
  projectPipelineId: z.string().min(1),
});
export type ProjectPipelineCheckRequest = z.infer<typeof projectPipelineCheckRequestSchema>;

/** What saving a Project Pipeline would be refused for and what the editor warns about but saves. */
export const projectPipelineCheckSchema = pipelineCheckSchema;
export type ProjectPipelineCheck = z.infer<typeof projectPipelineCheckSchema>;

/**
 * A Stage template (spec §2.3): a Stage kept in the Pipeline library to add to a Pipeline, whose
 * Stage stays linked to it, or to a Task's Stages as a copy. Its name is its Stage's; it never has
 * routes, which only a Pipeline gives meaning, nor `templateId`.
 */
export const stageTemplateSchema = z.object({ id: z.string().min(1), stage: stageSchema });
export type StageTemplate = z.infer<typeof stageTemplateSchema>;

export const stageTemplateListSchema = z.array(stageTemplateSchema);

/**
 * POST /stage-templates and PUT /stage-templates/:id: the template's Stage as the user edited it,
 * or a Stage saved as a template; its routes and place are dropped.
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
 * One Stage linked to a template (spec §2.3.5, "Editing a template with linked Stages"), with its
 * Pipeline: office-wide (`projectId` null) or a Project's. The Stage is whole, so the web works out
 * how it differs.
 */
export const linkedStageSchema = z.object({
  pipelineId: z.string().min(1),
  pipelineName: z.string(),
  projectId: z.string().min(1).nullable(),
  stage: stageSchema,
});
export type LinkedStage = z.infer<typeof linkedStageSchema>;

/** GET /stage-templates/:id/linked-stages: the office-wide Pipelines' first, then the Projects'. */
export const linkedStageListSchema = z.array(linkedStageSchema);

/** A linked Stage by its Pipeline and its key. */
export const linkedStageRefSchema = z.strictObject({
  pipelineId: z.string().min(1),
  stageKey: z.string().min(1),
});
export type LinkedStageRef = z.infer<typeof linkedStageRefSchema>;

/**
 * POST /stage-templates/:id/apply: sets the named template fields (`who` for Role and duty) to the
 * template's on the Stages chosen, each Pipeline saved as its editor saves it.
 */
export const stageTemplateApplyRequestSchema = z.strictObject({
  fields: z.array(z.string().min(1)).min(1),
  stages: z.array(linkedStageRefSchema).min(1),
});
export type StageTemplateApplyRequest = z.infer<typeof stageTemplateApplyRequestSchema>;

/** A Pipeline the apply refused, keeping its Stages as they were, with why. */
export const refusedPipelineSchema = z.object({
  pipelineId: z.string().min(1),
  pipelineName: z.string(),
  projectId: z.string().min(1).nullable(),
  reasons: z.array(z.string()),
});
export type RefusedPipeline = z.infer<typeof refusedPipelineSchema>;

/** What the apply did: how many Stages got the edit, and each Pipeline refused. */
export const stageTemplateApplyResultSchema = z.object({
  applied: z.int().nonnegative(),
  refused: z.array(refusedPipelineSchema),
});
export type StageTemplateApplyResult = z.infer<typeof stageTemplateApplyResultSchema>;

const libraryPipelineIdInput = z.string().min(1).describe("The id of the office-wide Pipeline.");
const stageTemplateIdInput = z.string().min(1).describe("The id of the Stage template.");

/** Office action: an office-wide Pipeline made from scratch. */
export const ADD_LIBRARY_PIPELINE_ACTION = officeAction({
  name: "add_library_pipeline",
  title: "Add a Pipeline",
  description: `Adds an office-wide Pipeline to the library: its name, description, Stages and routes. Refused with every problem its Stages have, and when its name is taken. ${PIPELINE_STAGES_WORDS} ${PIPELINE_ROUTES_WORDS} ${PIPELINE_CHECKED_WORDS}`,
  input: pipelineEditSchema,
  answer: pipelineSchema,
  route: { method: "POST", path: "/pipelines" },
  status: 201,
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ name }) => ({ kind: "pipeline", id: name.trim() }),
});

/** Office action: an office-wide Pipeline made as a copy of another. */
export const COPY_LIBRARY_PIPELINE_ACTION = officeAction({
  name: "copy_library_pipeline",
  title: "Copy a Pipeline",
  description:
    "Makes an office-wide Pipeline as a copy of one of the library's, under a name of its own.",
  input: z.strictObject({
    copyOf: z.string().min(1).describe("The id of the library Pipeline to copy."),
  }),
  answer: pipelineSchema,
  route: { method: "POST", path: "/pipelines/copies" },
  status: 201,
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ copyOf }) => ({ kind: "pipeline", id: copyOf }),
});

/** Office action: an office-wide Pipeline saved as edited. */
export const CHANGE_LIBRARY_PIPELINE_ACTION = officeAction({
  name: "change_library_pipeline",
  title: "Change a Pipeline",
  description: `Saves an office-wide Pipeline as given: its name, description, Stages and routes whole, replacing what it has; read it first with list_pipelines. Tasks that haven't started follow it. Refused with every problem its Stages have; its id stays. ${PIPELINE_STAGES_WORDS} ${PIPELINE_ROUTES_WORDS} ${PIPELINE_CHECKED_WORDS}`,
  input: pipelineEditSchema.extend({ pipelineId: libraryPipelineIdInput }),
  answer: pipelineSchema,
  route: { method: "PUT", path: "/pipelines/:pipelineId" },
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ pipelineId }) => ({ kind: "pipeline", id: pipelineId }),
});

/** Office action: an office-wide Pipeline deleted. */
export const DELETE_LIBRARY_PIPELINE_ACTION = officeAction({
  name: "delete_library_pipeline",
  title: "Delete a Pipeline",
  description:
    "Deletes an office-wide Pipeline. Refused while a Project's Default Pipeline, a Task that hasn't ended or an Initiative uses it.",
  input: z.object({ pipelineId: libraryPipelineIdInput }),
  answer: z.void(),
  route: { method: "DELETE", path: "/pipelines/:pipelineId" },
  status: 204,
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ pipelineId }) => ({ kind: "pipeline", id: pipelineId }),
});

/** Office action: a Stage template made. */
export const ADD_STAGE_TEMPLATE_ACTION = officeAction({
  name: "add_stage_template",
  title: "Add a Stage template",
  description: `Adds a Stage template to the library: a Stage to add to Pipelines, whose Stage stays linked to it. Its routes and place are dropped. Refused with every problem the Stage has, and when its name is taken. ${STAGE_TEMPLATE_WORDS}`,
  input: stageTemplateEditSchema,
  answer: stageTemplateSchema,
  route: { method: "POST", path: "/stage-templates" },
  status: 201,
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ stage }) => ({ kind: "stage-template", id: stage.name.trim() }),
});

/** Office action: a Stage template saved as edited. */
export const CHANGE_STAGE_TEMPLATE_ACTION = officeAction({
  name: "change_stage_template",
  title: "Change a Stage template",
  description: `Saves a Stage template's Stage whole, replacing what it has; read it first with list_stage_templates. Its linked Stages keep their own values until the template is applied to them. Refused with every problem the Stage has. ${STAGE_TEMPLATE_WORDS}`,
  input: stageTemplateEditSchema.extend({ templateId: stageTemplateIdInput }),
  answer: stageTemplateSchema,
  route: { method: "PUT", path: "/stage-templates/:templateId" },
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ templateId }) => ({ kind: "stage-template", id: templateId }),
});

/** Office action: a Stage template's fields applied to the Stages linked to it. */
export const APPLY_STAGE_TEMPLATE_ACTION = officeAction({
  name: "apply_stage_template",
  title: "Apply a Stage template to its linked Stages",
  description:
    "Sets the named fields of the Stages chosen, each a Stage of a Pipeline linked to the template, to the template's, each Pipeline saved as its editor saves it. A Pipeline refused keeps its Stages and is named with why; the others still apply.",
  input: stageTemplateApplyRequestSchema.extend({ templateId: stageTemplateIdInput }),
  answer: stageTemplateApplyResultSchema,
  route: { method: "POST", path: "/stage-templates/:templateId/apply" },
  status: 200,
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ templateId }) => ({ kind: "stage-template", id: templateId }),
});

/** Office action: a Stage template deleted. */
export const DELETE_STAGE_TEMPLATE_ACTION = officeAction({
  name: "delete_stage_template",
  title: "Delete a Stage template",
  description:
    "Deletes a Stage template from the library; the Stages linked to it stay as they are, unlinked.",
  input: z.object({ templateId: stageTemplateIdInput }),
  answer: z.void(),
  route: { method: "DELETE", path: "/stage-templates/:templateId" },
  status: 204,
  area: "library",
  group: "pipelinesAndStageTemplates",
  subject: ({ templateId }) => ({ kind: "stage-template", id: templateId }),
});

/** The Office actions Pipelines carries out. */
export const PIPELINES_OFFICE_ACTIONS = [
  CONTINUE_AT_GATE_ACTION,
  SEND_BACK_AT_GATE_ACTION,
  DROP_AT_GATE_ACTION,
  RESTART_TASK_FROM_ACTION,
  EDIT_TASK_STAGES_ACTION,
  SWITCH_TO_STAND_IN_ACTION,
  CREATE_PROJECT_PIPELINE_ACTION,
  CHANGE_PROJECT_PIPELINE_ACTION,
  DELETE_PROJECT_PIPELINE_ACTION,
  ADD_LIBRARY_PIPELINE_ACTION,
  COPY_LIBRARY_PIPELINE_ACTION,
  CHANGE_LIBRARY_PIPELINE_ACTION,
  DELETE_LIBRARY_PIPELINE_ACTION,
  ADD_STAGE_TEMPLATE_ACTION,
  CHANGE_STAGE_TEMPLATE_ACTION,
  APPLY_STAGE_TEMPLATE_ACTION,
  DELETE_STAGE_TEMPLATE_ACTION,
] as const;

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
  /**
   * An Agent Stage run's session went on on a Stand-in Engine, its engine's usage window used up:
   * the run goes on Running there.
   */
  webEventSchema.extend({
    type: z.literal("stage-run.engine-switched"),
    taskId: z.uuid(),
    stageKey: z.string(),
    fromEngineId: z.string(),
    toEngineId: z.string(),
  }),
  /** The Stages waiting for the user's choice of a Stand-in Engine changed: refetch them. */
  webEventSchema.extend({ type: z.literal("stand-in-choices.changed") }),
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
    type: z.literal("stage-run.went-back"),
    taskId: z.uuid(),
    fromStageKey: z.string(),
    toStageKey: z.string(),
    round: z.int().positive(),
    rounds: z.int().positive().nullable(),
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
