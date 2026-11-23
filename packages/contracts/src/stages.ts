import { z } from "zod";
import {
  dutyKeySchema,
  effortSchema,
  hardSwitchValueSchema,
  runPermissionSchema,
} from "./people.js";
import { projectCommandKeySchema } from "./projects.js";
import { stageContextLimitsOverrideSchema } from "./stage-context-limits.js";

/** "On failure go back to Stage X, at most N times": the Stage's key and its rounds. */
export const onFailureSchema = z.object({
  goBackTo: z.string().min(1),
  rounds: z.int().positive(),
});

/** Where a Publish Stage takes the Task's branch (spec §2.3). */
export const publishTargetSchema = z.enum(["publishing-mode", "branch-only"]);
export type PublishTarget = z.infer<typeof publishTargetSchema>;

/** What a Publish Stage does once a conflict is resolved and tested (spec §2.3). */
export const afterConflictSchema = z.enum(["publish", "review"]);
export type AfterConflict = z.infer<typeof afterConflictSchema>;

/**
 * What an Agent Stage states of its Role card's permission profile (spec §6), each absent where the
 * card's stands: it may narrow the profile, never widen it, so editing and the web can only be taken
 * away. MCP tools are keyed `server/tool`, as on the card. `commands` keeps only those of the
 * Project's commands, by key; absent keeps every one, and install is never among them.
 */
export const stagePermissionsSchema = z.object({
  edit: z.literal(false).optional(),
  run: runPermissionSchema.optional(),
  web: z.literal(false).optional(),
  mcpTools: z.record(z.string().regex(/^[a-z0-9-]+\/.+$/), hardSwitchValueSchema).optional(),
  commands: z
    .array(projectCommandKeySchema)
    .min(1, "List at least one Project command, or leave the Role card's.")
    .refine((keys) => new Set(keys).size === keys.length, {
      error: "A Project command is listed twice.",
    })
    .optional(),
});
export type StagePermissions = z.infer<typeof stagePermissionsSchema>;

/**
 * What a Script Stage runs: `publish`, kept for Publish, or a Project command by its key. Install is
 * never a Stage's, as it runs before every Stage on its own (spec §2.3).
 */
export const scriptStageCommandSchema = z.union([z.literal("publish"), projectCommandKeySchema]);

/** What a Stage test says of its Stage's latest run, or of all its runs with `ran` (spec §2.3). */
export const stageTestOutcomeSchema = z.enum(["done", "failed", "skipped", "changed", "unchanged"]);
export type StageTestOutcome = z.infer<typeof stageTestOutcomeSchema>;

const testedStageFields = {
  /** The key of the Stage it tests; null is the route's own Stage, the one the walk just left. */
  stage: z.string().min(1).nullable(),
  /** The tested Stage's name when it was last saved, for its words alone, as a Stage change keeps. */
  stageName: z.string().optional(),
};

/**
 * One built-in test of a route's condition (spec §2.3), by `kind`: a Stage's latest run or how many
 * times it ran, the Definition of Done, or a Project command exiting 0.
 */
export const conditionTestSchema = z.discriminatedUnion("kind", [
  z.discriminatedUnion("is", [
    z.strictObject({ kind: z.literal("stage"), ...testedStageFields, is: stageTestOutcomeSchema }),
    z.strictObject({
      kind: z.literal("stage"),
      ...testedStageFields,
      is: z.literal("ran"),
      /** It holds when the Stage ran this many times or more, its latest run included. */
      times: z.int().positive(),
    }),
  ]),
  z.strictObject({
    kind: z.literal("definitionOfDone"),
    is: z.enum(["all-met", "some-not-met"]),
  }),
  z.strictObject({ kind: z.literal("command"), key: projectCommandKeySchema }),
]);
export type ConditionTest = z.infer<typeof conditionTestSchema>;

/** All of (AND) or Any of (OR) its tests and nested groups, weighed in order (spec §2.3). */
export interface ConditionGroup {
  combine: "all" | "any";
  tests: (ConditionTest | ConditionGroup)[];
}

export const conditionGroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.strictObject({
    combine: z.enum(["all", "any"]),
    tests: z.array(z.union([conditionTestSchema, conditionGroupSchema])),
  }),
);

/** A route out of a Stage (spec §2.3): to a later Stage by its key, or to End; null holds always. */
export const routeSchema = z.strictObject({
  to: z.string().min(1).nullable(),
  /** The name of the Stage it leads to when it was last saved, for its words alone. */
  toName: z.string().optional(),
  condition: conditionGroupSchema.nullable(),
});
export type Route = z.infer<typeof routeSchema>;

/** Where a Stage stands on the flow editor's canvas, which gives the Pipeline's order. */
export const stagePlaceSchema = z.strictObject({
  column: z.int().nonnegative(),
  row: z.int().nonnegative(),
});
export type StagePlace = z.infer<typeof stagePlaceSchema>;

const stageFields = {
  key: z.string().min(1),
  name: z.string(),
  /**
   * Read only by the previous release, which skipped the Stage once the Definition of Done was met;
   * the routes say it now (spec §2.3, "The optional setting becomes conditions").
   */
  optional: z.boolean(),
  /**
   * Its routes out, in the order the walk weighs them. Absent only on a Stage template and a Stage a
   * Stage change gives; a Pipeline's and a Task's Stages always carry them.
   */
  routes: z.array(routeSchema).optional(),
  /** Absent where `routes` is. */
  place: stagePlaceSchema.optional(),
  /**
   * The Stage template it is linked to (spec §2.3.1), on an office-wide or Project Pipeline's Stage
   * alone: never on a template's own Stage or a Task's. Absent is unlinked.
   */
  templateId: z.string().min(1).optional(),
};

/**
 * A Stage of a Pipeline (spec §2.3), apart from the rest of Pipelines' contracts so that a
 * Proposal of a Pipeline's Stages can name it.
 */
export const stageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    ...stageFields,
    /** The key of the Role that works it; a Stage names a Role or a duty, never both. */
    role: z.string().optional(),
    /** The duty whose holder works it when the Stage starts (spec §2.3). */
    duty: dutyKeySchema.optional(),
    brief: z.string(),
    session: z.enum(["fresh", "continue"]),
    /** Tokens. */
    budget: z.int().positive(),
    /** Absent keeps the Role's. */
    effort: effortSchema.optional(),
    /** Absent keeps the Role card's profile whole. */
    permissions: stagePermissionsSchema.optional(),
    /** Absent takes the Office defaults of Settings › Office limits (spec §2.5). */
    contextLimits: stageContextLimitsOverrideSchema.optional(),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({
    kind: z.literal("script"),
    ...stageFields,
    command: scriptStageCommandSchema,
    /**
     * A Publish Stage's alone: by the Project's publishing mode, or pushing the Task's branch only,
     * for a proof of concept. Absent means the publishing mode.
     */
    publishTarget: publishTargetSchema.optional(),
    /** A Publish Stage's alone: absent publishes automatically. */
    afterConflict: afterConflictSchema.optional(),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({ kind: z.literal("gate"), ...stageFields }),
]);
export type Stage = z.infer<typeof stageSchema>;

/**
 * Where on its Stage a problem is: the Stage itself, one of its routes (by its index among the
 * Stage's routes, and a test of its condition by its indexes, `[0, 1]`), or its on-failure setting.
 */
export const stageProblemAtSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stage") }),
  z.object({
    kind: z.literal("route"),
    routeIndex: z.int().nonnegative(),
    testPath: z.array(z.int().nonnegative()).optional(),
  }),
  z.object({ kind: z.literal("onFailure") }),
]);
export type StageProblemAt = z.infer<typeof stageProblemAtSchema>;

/**
 * Why Stages can't be saved (`problem`), or what the editor warns about but saves (`warning`), on the
 * Stage it concerns by its key, as the editor's draft may change before the answer comes back; both
 * null for the Pipeline as a whole. Save is refused while a `problem` stands.
 */
export const stageProblemSchema = z.object({
  stageKey: z.string().nullable(),
  at: stageProblemAtSchema.nullable(),
  level: z.enum(["problem", "warning"]),
  text: z.string(),
});
export type StageProblem = z.infer<typeof stageProblemSchema>;
export type StageProblemLevel = StageProblem["level"];
