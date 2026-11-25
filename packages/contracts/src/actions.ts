import { z } from "zod";

/** How long an Action's name may be (spec §2.15, "Action"). */
export const ACTION_NAME_MAX_LENGTH = 60;

/** The bounds of an Action's own time limit, in minutes (spec §2.15, "An Action's time limit"). */
export const ACTION_TIME_LIMIT_MINUTES = { min: 1, max: 240, default: 60 } as const;

/**
 * The variables The Office sets in a Project command run (spec §2.15, "What The Office sets"); a
 * Project variable of one of these names is refused while the Project has a Project command Action,
 * and such an Action while the Project has one.
 */
export const ACTION_RESERVED_VARIABLES = [
  "OFFICE_ACTION",
  "OFFICE_ACTION_BRANCH",
  "OFFICE_ACTION_COMMIT",
] as const;

/** The kinds an Action may be (spec §2.15, "Kinds"). */
export const ACTION_KINDS = ["project-command", "test-target", "workflow"] as const;
export const actionKindSchema = z.enum(ACTION_KINDS);
export type ActionKind = z.infer<typeof actionKindSchema>;

/**
 * A Project command Action's settings: the command, the commands before it, its own time limit and
 * the Project device its run holds.
 */
export const projectCommandActionSettingsSchema = z.object({
  commandKey: z.string(),
  /** The Project's commands run before it, `install` among them, in order, by their keys. */
  commandsBefore: z.array(z.string()).default([]),
  /** Its own time limit in minutes; null when the default applies. */
  timeLimitMinutes: z.number().int().nullable().default(null),
  /** The Project device its run holds while it runs, by its id; null for none (spec §2.15). */
  projectDeviceId: z.string().nullable().default(null),
});
export type ProjectCommandActionSettings = z.infer<typeof projectCommandActionSettingsSchema>;

/** A Test target Action's settings: the target it launches, by key. */
export const testTargetActionSettingsSchema = z.object({ targetKey: z.string() });
export type TestTargetActionSettings = z.infer<typeof testTargetActionSettingsSchema>;

/** A Workflow Action's settings: the Workflow's file and its inputs, fixed with the Action. */
export const workflowActionSettingsSchema = z.object({
  /** The Workflow's file name, such as release.yml, as Work › CI's Start a workflow lists it. */
  file: z.string(),
  /** Its inputs by name, each as text: true or false for a yes-no. Left out, its default. */
  inputs: z.record(z.string(), z.string()).default({}),
});
export type WorkflowActionSettings = z.infer<typeof workflowActionSettingsSchema>;

/** The values of an Action that each record who set them last. */
export const actionFieldSchema = z.enum(["name", "kind", "settings", "leavesTheWorkstation"]);
export type ActionField = z.infer<typeof actionFieldSchema>;

/** Who set a value last: a user on the Project page, or a Proposal an Agent drafted. */
export const actionSetterSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("user"), user: z.object({ userId: z.string(), name: z.string() }) }),
  z.object({
    by: z.literal("proposal"),
    proposalId: z.string(),
    agent: z.object({ roleKey: z.string(), name: z.string() }),
  }),
]);
export type ActionSetter = z.infer<typeof actionSetterSchema>;

/** Who set each value last; a value missing was never set by anyone known. */
export const actionSetBySchema = z.partialRecord(actionFieldSchema, actionSetterSchema);
export type ActionSetBy = z.infer<typeof actionSetBySchema>;

/** An Action's values for its kind, with the `extra` fields every kind has. */
function actionOfKind<Extra extends z.ZodRawShape>(extra: Extra) {
  const head = { key: z.string(), name: z.string(), leavesTheWorkstation: z.boolean(), ...extra };
  return z.discriminatedUnion("kind", [
    z.object({
      ...head,
      kind: z.literal("project-command"),
      settings: projectCommandActionSettingsSchema,
    }),
    z.object({ ...head, kind: z.literal("test-target"), settings: testTargetActionSettingsSchema }),
    z.object({ ...head, kind: z.literal("workflow"), settings: workflowActionSettingsSchema }),
  ]);
}

/** An Action as the service answers it (GET /projects/:id/actions). */
export const actionSchema = actionOfKind({ setBy: actionSetBySchema });
export type Action = z.infer<typeof actionSchema>;

/** GET /projects/:id/actions: the Project's Actions, in the order added. */
export const actionListSchema = z.object({ actions: z.array(actionSchema) });
export type ActionList = z.infer<typeof actionListSchema>;

/** An Action as the Project page saves it, and as a Proposal carries it. */
export const editedActionSchema = actionOfKind({});
export type EditedAction = z.infer<typeof editedActionSchema>;

/**
 * PUT /projects/:id/actions: the Project's Actions, whole and in order. An Action left out is
 * removed; a key, once added, never changes.
 */
export const actionsEditSchema = z.object({ actions: z.array(editedActionSchema) });
export type ActionsEdit = z.infer<typeof actionsEditSchema>;

/**
 * What a Proposal of Actions changes (spec §2.15, "Defining Actions"), by key: each Action as the
 * Project had it when drafted (`from`, null for one added) and as proposed (`to`, null for one
 * removed). `userSet` names the values the user set that it changes, flagged "You set this".
 * Applying is refused once a `from` no longer holds.
 */
export const proposedActionsSchema = z.object({
  actions: z.array(
    z.object({
      key: z.string(),
      from: editedActionSchema.nullable(),
      to: editedActionSchema.nullable(),
      userSet: z.array(actionFieldSchema),
    }),
  ),
});
export type ProposedActions = z.infer<typeof proposedActionsSchema>;
export type ProposedAction = ProposedActions["actions"][number];
