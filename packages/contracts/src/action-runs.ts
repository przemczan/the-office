import { z } from "zod";
import { ciRunStatusSchema } from "./ci-runs.js";
import { relayTabSchema } from "./devices.js";
import { webEventSchema } from "./events.js";
import { testInstanceBranchSchema, testInstanceStateSchema } from "./test-instances.js";
import { userRefSchema } from "./users.js";

/** A Project command run's states (spec §2.15, "States"). */
export const projectCommandRunStateSchema = z.enum(["running", "succeeded", "failed", "stopped"]);
export type ProjectCommandRunState = z.infer<typeof projectCommandRunStateSchema>;

/** A Workflow run's states: Starting while The Office waits for its CI run, then the CI run's. */
export const workflowRunStateSchema = z.enum(["starting", ...ciRunStatusSchema.options]);
export type WorkflowRunState = z.infer<typeof workflowRunStateSchema>;

/**
 * An Action run's state, in its kind's own words (spec §2.15, "States"): a Project command run's,
 * a Test target run's test instance's, or a Workflow run's.
 */
export const actionRunStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project-command"), state: projectCommandRunStateSchema }),
  z.object({ kind: z.literal("test-target"), state: testInstanceStateSchema }),
  z.object({ kind: z.literal("workflow"), state: workflowRunStateSchema }),
]);
export type ActionRunState = z.infer<typeof actionRunStateSchema>;

/** How a run ended, whatever its kind: null while it is running. */
export const actionRunOutcomeSchema = z.enum(["succeeded", "failed", "stopped"]);
export type ActionRunOutcome = z.infer<typeof actionRunOutcomeSchema>;

/** What a start chooses to run from (spec §2.15, "What it runs from"). */
export const actionRunSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch"), branch: testInstanceBranchSchema }),
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
]);
export type ActionRunSource = z.infer<typeof actionRunSourceSchema>;

/** What a run ran from, as it records it: the choice, with the Task's or Initiative's name. */
export const actionRunRanFromSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("branch") }),
  z.object({ kind: z.literal("task"), taskId: z.uuid(), title: z.string() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid(), name: z.string() }),
]);
export type ActionRunRanFrom = z.infer<typeof actionRunRanFromSchema>;

/** A Workflow run's CI run, once it showed on the code host. */
export const actionRunCiRunSchema = z.object({
  id: z.number().int().positive(),
  /** The Workflow's name and the run's number, as "<workflow> #<number>" reads. */
  workflowName: z.string(),
  number: z.number().int().positive(),
  url: z.url(),
});
export type ActionRunCiRun = z.infer<typeof actionRunCiRunSchema>;

/** One start of one Action (spec §2.15, "Action run"). */
export const actionRunSchema = z.object({
  id: z.uuid(),
  projectId: z.string(),
  actionKey: z.string(),
  /** The Action's name and kind as they were at its start. */
  actionName: z.string(),
  status: actionRunStateSchema,
  /** How it ended; null while it is running. */
  outcome: actionRunOutcomeSchema.nullable(),
  ranFrom: actionRunRanFromSchema,
  /** The branch it ran from. */
  branch: z.string(),
  /** The commit it ran; a Workflow run's as its CI run reports it, null until known. */
  commit: z.string().nullable(),
  /** "It ran <commit>: <branch> moved as it started.", for a Workflow run whose commit differs. */
  note: z.string().nullable(),
  startedBy: userRefSchema,
  startedAt: z.iso.datetime(),
  /** Null while it is running. */
  endedAt: z.iso.datetime().nullable(),
  /** A Project command run's exit code, when its command ended with one. */
  exitCode: z.number().int().nullable(),
  /** Why it Failed or was Stopped, in the user's words; null otherwise. */
  endedBecause: z.string().nullable(),
  /** A Test target run's test instance. */
  testInstanceId: z.uuid().nullable(),
  /** The Project device the run holds, or held, by its name at the start; null for none. */
  deviceName: z.string().nullable(),
  /** A Workflow run's CI run, once it showed. */
  ciRun: actionRunCiRunSchema.nullable(),
  /** The Workflow's runs on the code host, linked when its CI run didn't show. */
  workflowRunsUrl: z.url().nullable(),
});
export type ActionRun = z.infer<typeof actionRunSchema>;

/** One Action's runs, newest first, the newest 20 kept. */
export const actionRunHistorySchema = z.object({
  actionKey: z.string(),
  runs: z.array(actionRunSchema),
});
export type ActionRunHistory = z.infer<typeof actionRunHistorySchema>;

/** GET /projects/:id/actions/runs: each Action's runs, newest first. */
export const projectActionRunsSchema = z.object({ actions: z.array(actionRunHistorySchema) });
export type ProjectActionRuns = z.infer<typeof projectActionRunsSchema>;

/**
 * POST /projects/:id/actions/:key/runs: start an Action on what was chosen. `commit` is required
 * for an Action that leaves the workstation, the one its confirm step showed; the start is refused
 * when the branch moved since. It answers the new run.
 */
export const actionRunStartSchema = z.object({
  source: actionRunSourceSchema,
  /**
   * The tab relaying the run's Project device over USB, the Action's own or its Install on a
   * device target's (spec §2.13, "A Project device over USB").
   */
  relayTab: relayTabSchema.optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/, "That isn't a commit.")
    .optional(),
});
export type ActionRunStart = z.infer<typeof actionRunStartSchema>;

/**
 * GET /projects/:id/actions/source?kind=branch&branch=… (or kind=task&taskId=…,
 * kind=initiative&initiativeId=…): what a start from it would run, the branch's fetched tip with
 * its subject, as the Run window shows it. `problem` says why it can't be read.
 */
export const actionRunSourceQuerySchema = actionRunSourceSchema;
export type ActionRunSourceQuery = z.infer<typeof actionRunSourceQuerySchema>;

export const actionRunSourceTipSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tip"),
    branch: z.string(),
    commit: z.string(),
    subject: z.string(),
  }),
  z.object({ kind: z.literal("problem"), problem: z.string() }),
]);
export type ActionRunSourceTip = z.infer<typeof actionRunSourceTipSchema>;

/**
 * GET /action-runs/:id/log?from=<offset>: the masked log from a byte offset, the offset to read on
 * from, and the run's state, so a reader stops following once it has ended.
 */
export const actionRunLogSchema = z.object({
  text: z.string(),
  nextOffset: z.number().int().min(0),
  status: actionRunStateSchema,
  outcome: actionRunOutcomeSchema.nullable(),
});
export type ActionRunLog = z.infer<typeof actionRunLogSchema>;

/** Settings › Office limits' Actions card: how many Project command runs may run together. */
export const ACTIONS_AT_ONCE = { min: 1, max: 6, default: 2 } as const;

const ACTIONS_AT_ONCE_ERROR = `Actions at once is a whole number from ${ACTIONS_AT_ONCE.min} to ${ACTIONS_AT_ONCE.max}.`;

/** GET and PUT /settings/actions (spec §2.15, "Actions at once"). */
export const actionSettingsSchema = z.object({
  actionsAtOnce: z
    .int({ error: ACTIONS_AT_ONCE_ERROR })
    .min(ACTIONS_AT_ONCE.min, { error: ACTIONS_AT_ONCE_ERROR })
    .max(ACTIONS_AT_ONCE.max, { error: ACTIONS_AT_ONCE_ERROR }),
});
export type ActionSettings = z.infer<typeof actionSettingsSchema>;

export const DEFAULT_ACTION_SETTINGS: ActionSettings = { actionsAtOnce: ACTIONS_AT_ONCE.default };

/**
 * An Action run started, changed state or was removed, so the Project's Actions read their runs
 * again; or Actions at once changed, so Settings › Office limits reads it again.
 */
export const actionRunWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({
    type: z.literal("action-run.changed"),
    projectId: z.string(),
    actionKey: z.string(),
  }),
  webEventSchema.extend({ type: z.literal("action-settings.changed") }),
]);
export type ActionRunWebEvent = z.infer<typeof actionRunWebEventSchema>;
