import { z } from "zod";
import {
  effortSchema,
  engineCapabilitySchema,
  engineIdSchema,
  engineModelSchema,
  engineTypeSchema,
} from "./engines.js";
import {
  authorityAreaSchema,
  authorityGroupSchema,
  authorityInEffectSchema,
  authoritySchema,
  authoritySettingSchema,
} from "./authority.js";
import { webEventSchema } from "./events.js";
import { imageSchema } from "./images.js";
import { officeAction } from "./office-actions.js";
import { userRefSchema } from "./users.js";

export { effortSchema, type Effort } from "./engines.js";

/** The Role's default for continuing a Thread. */
export const sessionDefaultSchema = z.enum([
  "context-policy",
  "always-start-fresh",
  "prefer-to-continue",
]);
export type SessionDefault = z.infer<typeof sessionDefaultSchema>;

export const capabilitiesSchema = z.object({
  sharedMemory: z.boolean(),
  chat: z.boolean(),
  consultant: z.boolean(),
  runEnvironment: z.boolean(),
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/** Which commands an Agent may run; read-only git under each. */
export const runPermissionSchema = z.enum(["read-only-git", "project-commands", "anything"]);
export type RunPermission = z.infer<typeof runPermissionSchema>;

export const hardSwitchKeySchema = z.enum([
  "runInstalls",
  "publishOutsideThePipeline",
  "changeRoles",
  "changeProjectSettings",
]);
export type HardSwitchKey = z.infer<typeof hardSwitchKeySchema>;

/** A Consult value names the Role to consult by its key. */
export const hardSwitchValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("allowed") }),
  z.object({ kind: z.literal("consult"), role: z.string() }),
  z.object({ kind: z.literal("ask-me") }),
  z.object({ kind: z.literal("never") }),
]);
export type HardSwitchValue = z.infer<typeof hardSwitchValueSchema>;

export const permissionProfileSchema = z.object({
  edit: z.boolean(),
  run: runPermissionSchema,
  web: z.boolean(),
  /**
   * Each tool of the Role's MCP servers the user set, keyed `server/tool`, set like a Hard switch;
   * any other is at Consult Devops.
   */
  mcpTools: z.record(z.string(), hardSwitchValueSchema),
});
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

export const hardSwitchesSchema = z.object({
  runInstalls: hardSwitchValueSchema,
  publishOutsideThePipeline: hardSwitchValueSchema,
  changeRoles: hardSwitchValueSchema,
  changeProjectSettings: hardSwitchValueSchema,
});
export type HardSwitches = z.infer<typeof hardSwitchesSchema>;

/** A number of Tasks at once, or "none": the person only talks. */
export const taskLimitSchema = z.union([z.number(), z.literal("none")]);
export type TaskLimit = z.infer<typeof taskLimitSchema>;

/** How a person works on one engine type: each null is "Engine's default". */
export const engineTypeSettingSchema = z.object({
  model: z.string().nullable(),
  effort: effortSchema.nullable(),
});
export type EngineTypeSetting = z.infer<typeof engineTypeSettingSchema>;

/** A person's model and effort for each engine type they set; a type left out is the engine's default. */
export const personEngineSettingsSchema = z.partialRecord(
  engineTypeSchema,
  engineTypeSettingSchema,
);
export type PersonEngineSettings = z.infer<typeof personEngineSettingsSchema>;

/**
 * A Role card, as PUT /roles/:key/card saves it and POST /roles hires from scratch with it.
 * `authority`, when given, is the card's Authority and `hardSwitches` is ignored; a card without it
 * (an earlier release's, an open Proposal's) takes its Authority from its Hard switches.
 */
export const roleCardSchema = z.object({
  name: z.string(),
  title: z.string(),
  responsibilities: z.string(),
  instructions: z.string(),
  /** The model and effort the person works with on each engine type (spec §5.4.5). */
  engineSettings: personEngineSettingsSchema,
  capabilities: capabilitiesSchema,
  permissionProfile: permissionProfileSchema,
  /** The four named groups of `authority` as the release before it reads them. */
  hardSwitches: hardSwitchesSchema,
  /** The rows the card sets (spec §6 › Authority); a row left out is at the preset's default. */
  authority: authoritySchema.optional(),
  taskLimit: taskLimitSchema,
  sessionDefault: sessionDefaultSchema,
  /** The library skills the Role has besides the skills for everyone, by name. */
  skills: z.array(z.string()),
});
export type RoleCard = z.infer<typeof roleCardSchema>;

/** A Role card as the service answers it, its Authority always given. */
export const savedRoleCardSchema = roleCardSchema.extend({ authority: authoritySchema });
export type SavedRoleCard = z.infer<typeof savedRoleCardSchema>;

/**
 * An MCP server the Role has (PUT /mcp-servers/:name/roles assigns it): whether it is on, and each
 * tool its sessions get with the tool's setting on the card, the default included.
 */
export const roleMcpServerSchema = z.object({
  name: z.string(),
  on: z.boolean(),
  tools: z.array(z.object({ name: z.string(), setting: hardSwitchValueSchema })),
});
export type RoleMcpServer = z.infer<typeof roleMcpServerSchema>;

/** A Role someone fills, by the key Pipelines and Consult values name it by. */
export const roleSchema = z.object({
  key: z.string().min(1),
  card: savedRoleCardSchema,
  /** Where each row of the card's Authority stands at the preset's default, which Reset puts back. */
  presetAuthority: authorityInEffectSchema,
  /** The version sessions start with now, from 1. */
  cardVersion: z.number().int().positive(),
  hiredAt: z.iso.datetime(),
  cardSavedAt: z.iso.datetime(),
  /** When the person was let go; null while they fill the Role. */
  letGoAt: z.iso.datetime().nullable(),
  /** The person's own picture, in place of their initials; null when they have none. Not on the card. */
  avatar: imageSchema.nullable(),
  /**
   * The built-in Caretaker (spec §2.2): never hired or let go; their capabilities, permission
   * profile, Authority and Task limit are fixed.
   */
  builtIn: z.boolean(),
  /** The Authority rows whose Consult value names a Role nobody fills, so they ask the user for now. */
  askingYouUntilHired: z.array(authorityGroupSchema),
  /** In name order. */
  mcpServers: z.array(roleMcpServerSchema),
});
export type Role = z.infer<typeof roleSchema>;

export const roleListSchema = z.array(roleSchema);

/** POST /roles: hires a person into the Role of the preset keyed `roleKey`. */
export const hireFromPresetSchema = z.object({ roleKey: z.string(), name: z.string() });
export type HireFromPreset = z.infer<typeof hireFromPresetSchema>;

/** POST /roles: hires a person into a new Role, keyed from the card's title, with the whole card. */
export const hireFromScratchSchema = z.object({ card: roleCardSchema });
export type HireFromScratch = z.infer<typeof hireFromScratchSchema>;

export const hireSchema = z.union([hireFromPresetSchema, hireFromScratchSchema]);
export type Hire = z.infer<typeof hireSchema>;

/** Spec §2.2's duties, by key, in its order. */
export const dutyKeySchema = z.enum([
  "default-person-to-talk-to",
  "shapes-initiatives",
  "asked-first-when-out-of-tries",
  "onboards-projects",
  "mcp-tool-consultant",
  "plans",
  "implements",
  "reviews",
]);
export type DutyKey = z.infer<typeof dutyKeySchema>;

/**
 * GET /presets: what hiring starts from; a hired Role starts with no skills of its own. `duties` are
 * the duties held by the preset's key by default, which hiring it brings while none is set elsewhere.
 */
export const presetSchema = z.object({
  roleKey: z.string(),
  suggestedName: z.string(),
  card: savedRoleCardSchema.omit({ name: true, skills: true }),
  /** Where each Authority row of a card hired from the preset starts. */
  presetAuthority: authorityInEffectSchema,
  duties: z.array(dutyKeySchema),
});
export type Preset = z.infer<typeof presetSchema>;

export const presetListSchema = z.array(presetSchema);

/** GET /role-card-options: the choices the Role card form offers, and how each switch is seen to. */
export const roleCardOptionsSchema = z.object({
  /** Every engine type, in Settings › Engines' order of their first engine, then the types none lists. */
  engineTypes: z.array(
    z.object({
      type: engineTypeSchema,
      /** Whether Settings › Engines lists an engine of the type. */
      listed: z.boolean(),
      /** The models its listed engines offer together, each telling whether all of them offer it. */
      models: z.array(z.object({ model: z.string(), onEveryAccount: z.boolean() })),
      /** The efforts the type takes, in its order; none hides Effort. */
      efforts: z.array(effortSchema),
    }),
  ),
  /** Each engine Settings › Engines lists, with what it declares it can't do. */
  engines: z.array(
    z.object({
      /** The engine, by its id. */
      engine: engineIdSchema,
      /** What the engine declares it can't do, which the card names under Runs on. */
      missingCapabilities: z.array(engineCapabilitySchema),
    }),
  ),
  /** Every Role a Consult value may name, hired or not. */
  knownRoles: z.array(z.object({ key: z.string(), title: z.string() })),
  hardSwitches: z.array(
    z.object({ key: hardSwitchKeySchema, enforcement: z.enum(["enforced", "followed"]) }),
  ),
  /** The Authority section's areas and rows, in the card's order. */
  authority: z.array(authorityAreaSchema),
  /** Where each Authority row of a Role hired from scratch starts. */
  fromScratchAuthority: authorityInEffectSchema,
  /** Where an MCP tool's setting starts, until the user sets it on the card. */
  mcpToolDefault: hardSwitchValueSchema,
  taskLimits: z.object({ lowest: z.number().int(), highest: z.number().int() }),
});
export type RoleCardOptions = z.infer<typeof roleCardOptionsSchema>;

/** The levels of the engine cascade, least specific first (spec §5.4.5): where a session runs. */
export const engineCascadeLevelSchema = z.enum(["office", "project", "initiative", "task"]);
export type EngineCascadeLevel = z.infer<typeof engineCascadeLevelSchema>;

/**
 * The levels of the model and effort cascade, least specific first (spec §5.4.5): the engine's
 * default, the person's setting, the Project's setting for the person, the Project's force, the
 * Stage's effort, and the Task's setting for the person.
 */
export const workCascadeLevelSchema = z.enum([
  "engine",
  "person",
  "projectPerson",
  "projectForce",
  "stage",
  "taskPerson",
]);
export type WorkCascadeLevel = z.infer<typeof workCascadeLevelSchema>;

/**
 * The engine a Role's session runs on (its id, type and name), with the level that gave it, and the
 * model and effort the person works with there, each with the level that gave it; `effort` null
 * leaves it to the runtime.
 */
export const engineInCascadeSchema = engineModelSchema.extend({
  level: engineCascadeLevelSchema,
  engineType: engineTypeSchema,
  engineName: z.string(),
  effort: effortSchema.nullable(),
  modelLevel: workCascadeLevelSchema,
  effortLevel: workCascadeLevelSchema,
});
export type EngineInCascade = z.infer<typeof engineInCascadeSchema>;

/** The engine everyone in a place runs on (its id, type and name), with the level that gave it. */
export const placeEngineInCascadeSchema = z.object({
  engineId: engineModelSchema.shape.engineId,
  engineType: engineTypeSchema,
  engineName: z.string(),
  level: engineCascadeLevelSchema,
});
export type PlaceEngineInCascade = z.infer<typeof placeEngineInCascadeSchema>;

/** The model and effort a person works with on the place's engine, each with the level that gave it. */
export const workInCascadeSchema = engineInCascadeSchema.pick({
  model: true,
  effort: true,
  modelLevel: true,
  effortLevel: true,
});
export type WorkInCascade = z.infer<typeof workInCascadeSchema>;

/**
 * The Stand-in Engine list that applies in a place (spec §5.4.6): the Project's own while it uses
 * it, else the Office's; `none`, with no engines, under an engine override, which never gives way.
 */
export const standInsApplyingSchema = z.object({
  from: z.enum(["office", "project", "none"]),
  engineIds: z.array(engineIdSchema),
});
export type StandInsApplying = z.infer<typeof standInsApplyingSchema>;

/**
 * GET /tasks/:id/engine-cascade: the one engine the Task's sessions run on, and the model and effort
 * the Planner and each Role the Task's Stages name work with there, with the level that gave each;
 * `engine` and each `work` null while no engine is listed. Planner first, then in the Stages' order,
 * each Role once, with each of its Stages that sets its own effort.
 */
export const taskEngineCascadeSchema = z.object({
  engine: placeEngineInCascadeSchema.nullable(),
  standIns: standInsApplyingSchema,
  people: z.array(
    z.object({
      roleKey: z.string(),
      roleName: z.string(),
      work: workInCascadeSchema.nullable(),
      stages: z.array(z.object({ stageName: z.string(), effort: effortSchema })),
    }),
  ),
});
export type TaskEngineCascade = z.infer<typeof taskEngineCascadeSchema>;

/** GET /roles/:key/engine-cascade: what the Role card says applies, for a Role someone fills. */
export const roleEngineCascadeSchema = z.object({
  /** Null while no engine is listed, so nothing runs. */
  outsideProjects: engineInCascadeSchema.nullable(),
  /** Only the Projects whose engine, model or effort differs from `outsideProjects`. */
  elsewhereInProjects: z.array(engineInCascadeSchema.extend({ projectId: z.string() })),
});
export type RoleEngineCascade = z.infer<typeof roleEngineCascadeSchema>;

/**
 * A part of a Role card as its change history names it, down to each capability and switch.
 * `engine` and `model` are named only by entries saved before the card had a Role override, and
 * `roleOverride` and `effort` only by entries saved before it had `engineSettings`.
 * `engineSettingsMovedOver` says a card moved over to `engineSettings`: from its Role override, or
 * none, to the engine type the override's model moved to, or none when it had none or it was dropped.
 * `authorityMovedOver` says the card's Authority was made from its Hard switches and duties; each
 * `authority.<group>` goes from a setting, or null at the preset's default, to another;
 * `authorityFromDutiesHeld` says rows were given what the duties the person holds need;
 * `projectSettingProposalsMovedOver` says Change Project settings was set to Proposal where the card
 * kept Proposal rows of the retired `propose_project_commands`, `propose_test_targets` and
 * `propose_actions` tools. The
 * `hardSwitches.*` fields are named only by entries saved before the card had an Authority.
 */
export const roleCardFieldSchema = z.enum([
  "name",
  "title",
  "responsibilities",
  "instructions",
  "engine",
  "model",
  "roleOverride",
  "effort",
  "engineSettings",
  "engineSettingsMovedOver",
  "taskLimit",
  "sessionDefault",
  "capabilities.sharedMemory",
  "capabilities.chat",
  "capabilities.consultant",
  "capabilities.runEnvironment",
  "permissionProfile",
  "hardSwitches.runInstalls",
  "hardSwitches.publishOutsideThePipeline",
  "hardSwitches.changeRoles",
  "hardSwitches.changeProjectSettings",
  "authorityMovedOver",
  "authorityFromDutiesHeld",
  "projectSettingProposalsMovedOver",
  ...authorityGroupSchema.options.map((group) => `authority.${group}` as const),
]);
export type RoleCardField = z.infer<typeof roleCardFieldSchema>;

const roleCardValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  permissionProfileSchema,
  authoritySettingSchema,
  engineModelSchema,
  personEngineSettingsSchema,
  z.null(),
]);

/**
 * Who proposed a hire or a card change the user applied from a Proposal, by the key of their Role;
 * null when the user wrote it themselves.
 */
const proposedBySchema = z.string().nullable();

/**
 * The user who made a change; null when no user did (a person's own `change_role`, an engine's
 * removal) or before users existed, until the first user claims it.
 */
const changedBySchema = userRefSchema.nullable();

/** GET /roles/:key/changes, newest first: the Role's change history, ending with the hire. */
export const roleChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hired"),
    at: z.iso.datetime(),
    proposedBy: proposedBySchema,
    savedBy: changedBySchema,
  }),
  z.object({
    kind: z.literal("card-changed"),
    at: z.iso.datetime(),
    /** The version the change saved. */
    cardVersion: z.number().int().positive(),
    changes: z.array(
      z.object({ field: roleCardFieldSchema, from: roleCardValueSchema, to: roleCardValueSchema }),
    ),
    proposedBy: proposedBySchema,
    savedBy: changedBySchema,
  }),
  z.object({
    kind: z.literal("skills-changed"),
    at: z.iso.datetime(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changedBy: changedBySchema,
  }),
]);
export type RoleChange = z.infer<typeof roleChangeSchema>;

export const roleChangeListSchema = z.array(roleChangeSchema);

/**
 * What a refused hire, card change or duty change answers: every reason, also joined into Nest's
 * `message`.
 */
export const roleRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type RoleRefusal = z.infer<typeof roleRefusalSchema>;

/**
 * Who wrote a Memory note: a user on the Memory tab (null before users existed, until the first user
 * claims it), or an Agent in one of its Threads.
 */
export const memoryNoteSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), user: userRefSchema.nullable() }),
  z.object({
    kind: z.literal("agent"),
    threadId: z.string(),
    taskId: z.string().optional(),
    /** The title of the Task it was written on, as it is now; absent once that Task is gone. */
    taskTitle: z.string().optional(),
  }),
]);

/** One entry in a person's Memory, with the Project it is about when there is one. */
export const memoryNoteSchema = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  text: z.string(),
  source: memoryNoteSourceSchema,
  writtenAt: z.string(),
});
export type MemoryNote = z.infer<typeof memoryNoteSchema>;

/** A person's Memory, newest note first; `inUse` is false while Shared memory is off. */
export const memorySchema = z.object({
  inUse: z.boolean(),
  notes: z.array(memoryNoteSchema),
});
export type Memory = z.infer<typeof memorySchema>;

/** What the user writes on the Memory tab. */
export const memoryNoteDraftSchema = z.object({
  text: z.string(),
  projectId: z.string().optional(),
});
export type MemoryNoteDraft = z.infer<typeof memoryNoteDraftSchema>;

/** What applies while nobody holds a duty: the user, the Caretaker, or the Pipelines unstaffed. */
export const dutyFallbackSchema = z.enum(["user", "caretaker", "unstaffed"]);
export type DutyFallback = z.infer<typeof dutyFallbackSchema>;

/**
 * A duty and who holds it. `roleKey` is the Role it names, hired or not: the default while never
 * `set`, `null` when set to none. `holder` is that Role's person while hired; `fallback` applies
 * while there is none.
 */
export const dutySchema = z.object({
  key: dutyKeySchema,
  label: z.string(),
  defaultRoleKey: z.string(),
  set: z.boolean(),
  roleKey: z.string().nullable(),
  holder: z.object({ roleKey: z.string(), name: z.string(), title: z.string() }).nullable(),
  fallback: dutyFallbackSchema.nullable(),
  /**
   * The Authority rows the job needs (spec §2.2, "Duty"), each at its setting: what Settings ›
   * Duties offers to give a new holder. The duty itself grants nothing.
   */
  jobSettings: authoritySchema,
  /**
   * The rows of `jobSettings` the current holder's card leaves Never, each at the setting giving
   * it would put there; null while nobody holds the duty, empty once the card gives the job.
   */
  jobSettingsToGive: authoritySchema.nullable(),
});
export type Duty = z.infer<typeof dutySchema>;

export const dutyListSchema = z.array(dutySchema);

/** What the user sets a duty to: a hired Role's key, or `null` for none. */
export const dutyChangeSchema = z.object({ roleKey: z.string().min(1).nullable() });
export type DutyChange = z.infer<typeof dutyChangeSchema>;

/** The People events the web receives; each names the Role or the duty, so its queries refresh. */
export const roleWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("role.hired"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.let-go"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.hired-back"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.card-changed"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.avatar-changed"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.memory-changed"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("duty.changed"), duty: dutyKeySchema }),
]);
export type RoleWebEvent = z.infer<typeof roleWebEventSchema>;

/** The key a Role hired from scratch gets from its card's title; People's `roleKeyFor` makes the same. */
function roleKeyOfTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const roleKeyInputSchema = z.string().min(1).describe("The Role's key, such as developer.");

/**
 * What POST /roles takes as one input: a hire from a preset (`roleKey` and `name`) or from scratch
 * (`card`), one of the two; the route's body is `hireSchema`'s either shape.
 */
export const hireRoleInputSchema = z
  .object({
    roleKey: z.string().min(1).optional().describe("The preset's key, to hire from a preset."),
    name: z.string().optional().describe("The new person's name, to hire from a preset."),
    card: roleCardSchema
      .optional()
      .describe("The whole Role card, to hire from scratch; the Role's key comes from its title."),
  })
  .refine(
    ({ roleKey, name, card }) =>
      card === undefined
        ? roleKey !== undefined && name !== undefined
        : roleKey === undefined && name === undefined,
    { message: "Give either a preset's roleKey and a name, or a card from scratch." },
  );
export type HireRoleInput = z.infer<typeof hireRoleInputSchema>;

/** The Role a hire gives, by its key. */
export function hiredRoleKeyOf(input: HireRoleInput): string {
  return input.card === undefined ? (input.roleKey ?? "") : roleKeyOfTitle(input.card.title);
}

/** Office action: hires a person into a Role, from a preset or from scratch. */
export const HIRE_ROLE_ACTION = officeAction({
  name: "hire_role",
  title: "Hire a person",
  description:
    "Hires a person into a Role, from a preset (roleKey and name) or from scratch (the whole card, its key made from its title). Refused with every reason when the card is invalid or someone fills the Role already. Ruled by your Change Roles setting, which a Proposal answers.",
  input: hireRoleInputSchema,
  answer: roleSchema,
  route: { method: "POST", path: "/roles" },
  status: 201,
  area: "peopleAndRoles",
  group: "changeRoles",
  subject: (input) => ({ kind: "role", id: hiredRoleKeyOf(input) }),
});

/** Office action: saves a Role's card as its next version. */
export const CHANGE_ROLE_CARD_ACTION = officeAction({
  name: "change_role_card",
  title: "Change a Role card",
  description:
    "Saves a Role's card, given whole, as its next version; sessions started afterwards read it. Start from read_role, since your session's copy may be old. Refused with every reason when the card is invalid. Ruled by your Change Roles setting, which a Proposal answers.",
  input: roleCardSchema.extend({ key: roleKeyInputSchema }),
  answer: roleSchema,
  route: { method: "PUT", path: "/roles/:key/card" },
  area: "peopleAndRoles",
  group: "changeRoles",
  subject: ({ key }) => ({ kind: "role", id: key }),
});

/** Office action: nobody fills the Role from now on. */
export const LET_GO_ROLE_ACTION = officeAction({
  name: "let_go_role",
  title: "Let a person go",
  description:
    "Lets the person in a Role go: nobody fills it from now on, and their card, Memory and chats stay, unused. Refused when they were let go already. Ruled by your Change Roles setting.",
  input: z.object({ key: roleKeyInputSchema }),
  answer: roleSchema,
  route: { method: "POST", path: "/roles/:key/let-go" },
  status: 201,
  area: "peopleAndRoles",
  group: "changeRoles",
  subject: ({ key }) => ({ kind: "role", id: key }),
});

/** Office action: the person let go fills the Role again. */
export const HIRE_BACK_ROLE_ACTION = officeAction({
  name: "hire_back_role",
  title: "Hire a person back",
  description:
    "Hires the person who was let go back into their Role, with their card, Memory and chats as they were. Refused when they fill it. Ruled by your Change Roles setting.",
  input: z.object({ key: roleKeyInputSchema }),
  answer: roleSchema,
  route: { method: "POST", path: "/roles/:key/hire-back" },
  status: 201,
  area: "peopleAndRoles",
  group: "changeRoles",
  subject: ({ key }) => ({ kind: "role", id: key }),
});

/** What deleting a Memory note answers. */
export const memoryNoteDeletedSchema = z.object({ key: z.string(), noteId: z.string() });
export type MemoryNoteDeleted = z.infer<typeof memoryNoteDeletedSchema>;

/** Office action: deletes one Memory note. */
export const DELETE_MEMORY_NOTE_ACTION = officeAction({
  name: "delete_memory_note",
  title: "Delete a Memory note",
  description:
    "Deletes one note from your own Memory; a person may delete only their own. Ruled by your Memory and Avatar setting.",
  input: z.object({
    key: roleKeyInputSchema.describe("Your own Role's key."),
    noteId: z.string().min(1).describe("The note's id, as your Memory lists it."),
  }),
  answer: memoryNoteDeletedSchema,
  route: { method: "DELETE", path: "/roles/:key/memory/:noteId" },
  area: "peopleAndRoles",
  group: "memoryAndAvatar",
  subject: ({ key }) => ({ kind: "role", id: key }),
});

/** Office action: an image Attachment becomes the person's Avatar. */
export const SET_AVATAR_FROM_ATTACHMENT_ACTION = officeAction({
  name: "set_avatar_from_attachment",
  title: "Set an Avatar from an Attachment",
  description:
    "Makes an image Attachment (PNG, JPEG, WebP or SVG, at most 2 MB) your own Avatar; a person sets only their own. The picture is never shown to you. Ruled by your Memory and Avatar setting.",
  input: z.object({
    key: roleKeyInputSchema.describe("Your own Role's key."),
    attachmentId: z.uuid().describe("The id of the image Attachment."),
  }),
  answer: roleSchema,
  route: { method: "POST", path: "/roles/:key/avatar/from-attachment" },
  status: 201,
  area: "peopleAndRoles",
  group: "memoryAndAvatar",
  subject: ({ key }) => ({ kind: "role", id: key }),
});

/** Office action: the person goes back to their initials. */
export const REMOVE_AVATAR_ACTION = officeAction({
  name: "remove_avatar",
  title: "Remove an Avatar",
  description:
    "Removes your own Avatar, so your initials show again; a person removes only their own. Ruled by your Memory and Avatar setting.",
  input: z.object({ key: roleKeyInputSchema.describe("Your own Role's key.") }),
  answer: roleSchema,
  route: { method: "DELETE", path: "/roles/:key/avatar" },
  area: "peopleAndRoles",
  group: "memoryAndAvatar",
  subject: ({ key }) => ({ kind: "role", id: key }),
});

/** People's Office actions, each declared above. */
export const PEOPLE_OFFICE_ACTIONS = [
  HIRE_ROLE_ACTION,
  CHANGE_ROLE_CARD_ACTION,
  LET_GO_ROLE_ACTION,
  HIRE_BACK_ROLE_ACTION,
  DELETE_MEMORY_NOTE_ACTION,
  SET_AVATAR_FROM_ATTACHMENT_ACTION,
  REMOVE_AVATAR_ACTION,
] as const;
