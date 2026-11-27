import { z } from "zod";

/**
 * Spec §6 › Authority's groups and single tools, in the Role card's order. The four Hard switches
 * are named groups among them: `runInstalls`, `publishOutsideThePipeline`, `changeRoles` and
 * `changeProjectSettings`.
 */
export const authorityGroupSchema = z.enum([
  "taskRecords",
  "movingWork",
  "gatesAndRuns",
  "continueAtGateOnOwnWork",
  "initiativeRecords",
  "runningAnInitiative",
  "ideas",
  "captureIdea",
  "changeProjectSettings",
  "publishingSettings",
  "projectSettings",
  "projectUpkeep",
  "secretValues",
  "changeRoles",
  "memoryAndAvatar",
  "skills",
  "mcpServers",
  "pipelinesAndStageTemplates",
  "promptTemplates",
  "officeSettings",
  "postLinkCard",
  "showOfficeStatus",
  "testInstances",
  "projectDevices",
  "fireAlarm",
  "checks",
  "updatesAndRestarts",
  "runInstalls",
  "publishOutsideThePipeline",
  "approveHeldCallsAndApplyProposals",
]);
export type AuthorityGroup = z.infer<typeof authorityGroupSchema>;

/**
 * Spec §6 › Tool areas: the nine areas a session loads together and the Role card's Authority shows,
 * each with the groups and single tools inside it. A group in no area (the followed groups and
 * Approve held calls and apply Proposals) holds no Office action.
 */
export const AUTHORITY_AREA_GROUPS = {
  work: ["taskRecords", "movingWork", "gatesAndRuns", "continueAtGateOnOwnWork"],
  initiatives: ["initiativeRecords", "runningAnInitiative"],
  ideas: ["ideas", "captureIdea"],
  projectsAndSettings: [
    "changeProjectSettings",
    "publishingSettings",
    "projectSettings",
    "projectUpkeep",
    "secretValues",
  ],
  peopleAndRoles: ["changeRoles", "memoryAndAvatar"],
  library: ["skills", "mcpServers", "pipelinesAndStageTemplates", "promptTemplates"],
  officeSettings: ["officeSettings", "postLinkCard", "showOfficeStatus"],
  testInstancesAndDevices: ["testInstances", "projectDevices"],
  operations: ["fireAlarm", "checks", "updatesAndRestarts"],
} as const satisfies Record<string, readonly AuthorityGroup[]>;

export const authorityAreaKeySchema = z.enum(
  Object.keys(AUTHORITY_AREA_GROUPS) as [keyof typeof AUTHORITY_AREA_GROUPS],
);
export type AuthorityAreaKey = z.infer<typeof authorityAreaKeySchema>;

/** Whether `group` is one of `area`'s groups or single tools in the catalog. */
export function isGroupOfArea(area: AuthorityAreaKey, group: AuthorityGroup): boolean {
  return (AUTHORITY_AREA_GROUPS[area] as readonly AuthorityGroup[]).includes(group);
}

/** A Consult value names the Role to consult by its key. */
export const authorityValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allowed") }),
  z.object({ kind: z.literal("consult"), role: z.string() }),
  z.object({ kind: z.literal("ask-me") }),
  z.object({ kind: z.literal("proposal") }),
  z.object({ kind: z.literal("never") }),
]);
export type AuthorityValue = z.infer<typeof authorityValueSchema>;

/** A row's setting: one value, or one on the person's own records and one on others'. */
export const authoritySettingSchema = z.union([
  authorityValueSchema,
  z.object({
    kind: z.literal("own-and-others"),
    own: authorityValueSchema,
    others: authorityValueSchema,
  }),
]);
export type AuthoritySetting = z.infer<typeof authoritySettingSchema>;

/** The rows a Role card sets; a row left out is at the preset's default. */
export const authoritySchema = z.partialRecord(authorityGroupSchema, authoritySettingSchema);
export type Authority = z.infer<typeof authoritySchema>;

/** Every row's setting: a card's preset defaults, or what it amounts to with its set rows. */
export const authorityInEffectSchema = z.record(authorityGroupSchema, authoritySettingSchema);
export type AuthorityInEffect = z.infer<typeof authorityInEffectSchema>;

/**
 * Why a row takes only Proposal, Ask me or Never: the trust anchor (spec §6 › The trust anchor), or
 * The user's alone for Publishing settings.
 */
export const authorityCapSchema = z.enum(["trust-anchor", "users-alone"]);
export type AuthorityCap = z.infer<typeof authorityCapSchema>;

/** One row of the Authority section, as GET /role-card-options describes it. */
export const authorityRowSchema = z.object({
  group: authorityGroupSchema,
  label: z.string(),
  cap: authorityCapSchema.nullable(),
  /** Whether it may take an own and an others' value (Work, Initiatives and Ideas records). */
  ownAndOthers: z.boolean(),
  /** The Agent follows it in plain words, as no Office tool holds it yet. */
  followed: z.boolean(),
  /** The Office tool that enforces a followed group all the same, such as `run_environment_check`. */
  enforcedOn: z.string().nullable(),
  /** The values it takes, in the select's order. */
  values: z.array(z.enum(["allowed", "consult", "ask-me", "proposal", "never"])),
});
export type AuthorityRow = z.infer<typeof authorityRowSchema>;

/** A tool area and its rows; the followed groups and the approvals row come last, `label` null. */
export const authorityAreaSchema = z.object({
  /** The area's name; null for the followed groups and the row in no area. */
  label: z.string().nullable(),
  rows: z.array(authorityRowSchema),
});
export type AuthorityArea = z.infer<typeof authorityAreaSchema>;
