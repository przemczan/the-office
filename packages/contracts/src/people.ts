import { z } from "zod";
import {
  effortSchema,
  engineCapabilitySchema,
  engineIdSchema,
  engineModelSchema,
  engineTypeSchema,
} from "./engines.js";
import { webEventSchema } from "./events.js";
import { imageSchema } from "./images.js";
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

/** A Role card, as PUT /roles/:key/card saves it and POST /roles hires from scratch with it. */
export const roleCardSchema = z.object({
  name: z.string(),
  title: z.string(),
  responsibilities: z.string(),
  instructions: z.string(),
  /** The model and effort the person works with on each engine type (spec §5.4.5). */
  engineSettings: personEngineSettingsSchema,
  capabilities: capabilitiesSchema,
  permissionProfile: permissionProfileSchema,
  hardSwitches: hardSwitchesSchema,
  taskLimit: taskLimitSchema,
  sessionDefault: sessionDefaultSchema,
  /** The library skills the Role has besides the skills for everyone, by name. */
  skills: z.array(z.string()),
});
export type RoleCard = z.infer<typeof roleCardSchema>;

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
  card: roleCardSchema,
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
   * profile, Hard switches and Task limit are fixed.
   */
  builtIn: z.boolean(),
  /** The switches whose Consult value names a Role nobody fills, so they ask the user for now. */
  askingYouUntilHired: z.array(hardSwitchKeySchema),
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
  card: roleCardSchema.omit({ name: true, skills: true }),
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
  /** The engines the Project's and the Task's pickers offer. */
  engines: z.array(
    z.object({
      /** Each engine Settings › Engines lists, by its id. */
      engine: engineIdSchema,
      models: z.array(z.string()),
      /** One of `models`: what picking the engine fills in. */
      defaultModel: z.string(),
      /** What the engine declares it can't do, which the card names under its Engine field. */
      missingCapabilities: z.array(engineCapabilitySchema),
    }),
  ),
  /** Every Role a Consult value may name, hired or not. */
  knownRoles: z.array(z.object({ key: z.string(), title: z.string() })),
  hardSwitches: z.array(
    z.object({ key: hardSwitchKeySchema, enforcement: z.enum(["enforced", "followed"]) }),
  ),
  /** Where an MCP tool's setting starts, until the user sets it on the card. */
  mcpToolDefault: hardSwitchValueSchema,
  taskLimits: z.object({ lowest: z.number().int(), highest: z.number().int() }),
});
export type RoleCardOptions = z.infer<typeof roleCardOptionsSchema>;

/** The levels of the engine cascade, least specific first (spec §5.4.5): where a session runs. */
export const engineCascadeLevelSchema = z.enum([
  "office-default",
  "project-default",
  "initiative-engine",
  "task-engine",
]);
export type EngineCascadeLevel = z.infer<typeof engineCascadeLevelSchema>;

/**
 * The levels of the model and effort cascade, least specific first (spec §5.4.5): the engine's
 * default, the person's setting, the Project's setting for the person, the Project's force, and the
 * Stage's effort.
 */
export const workCascadeLevelSchema = z.enum([
  "engine",
  "person",
  "projectPerson",
  "projectForce",
  "stage",
]);
export type WorkCascadeLevel = z.infer<typeof workCascadeLevelSchema>;

/**
 * The engine a Role's session runs on, with the level that gave it, and the model and effort the
 * person works with there, each with the level that gave it; `effort` null leaves it to the runtime.
 */
export const engineInCascadeSchema = engineModelSchema.extend({
  level: engineCascadeLevelSchema,
  engineType: engineTypeSchema,
  effort: effortSchema.nullable(),
  modelLevel: workCascadeLevelSchema,
  effortLevel: workCascadeLevelSchema,
});
export type EngineInCascade = z.infer<typeof engineInCascadeSchema>;

/** The engine everyone in a place runs on, with the level that gave it. */
export const placeEngineInCascadeSchema = z.object({
  engineId: engineModelSchema.shape.engineId,
  engineType: engineTypeSchema,
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
 * GET /tasks/:id/engine-cascade: the one engine the Task's sessions run on, and the model and effort
 * the Planner and each Role the Task's Stages name work with there, with the level that gave each;
 * `engine` and each `work` null while no engine is listed. Planner first, then in the Stages' order,
 * each Role once, with each of its Stages that sets its own effort.
 */
export const taskEngineCascadeSchema = z.object({
  engine: placeEngineInCascadeSchema.nullable(),
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
 * `engineSettingsMovedOver` names the Role override the move to `engineSettings` left behind.
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
]);
export type RoleCardField = z.infer<typeof roleCardFieldSchema>;

const roleCardValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  permissionProfileSchema,
  hardSwitchValueSchema,
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
