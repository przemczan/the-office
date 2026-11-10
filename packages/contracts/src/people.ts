import { z } from "zod";
import { engineCapabilitySchema, engineIdSchema, engineModelSchema } from "./engines.js";
import { webEventSchema } from "./events.js";
import { imageSchema } from "./images.js";

/** How hard the model thinks. */
export const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof effortSchema>;

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

/** A Role card, as PUT /roles/:key/card saves it and POST /roles hires from scratch with it. */
export const roleCardSchema = z.object({
  name: z.string(),
  title: z.string(),
  responsibilities: z.string(),
  instructions: z.string(),
  /** The engine and model the Role runs on outside a Project's own levels; null: the Office default. */
  roleOverride: engineModelSchema.nullable(),
  effort: effortSchema,
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

/** GET /presets: what hiring starts from; a hired Role starts with no skills of its own. */
export const presetSchema = z.object({
  roleKey: z.string(),
  suggestedName: z.string(),
  card: roleCardSchema.omit({ name: true, skills: true }),
});
export type Preset = z.infer<typeof presetSchema>;

export const presetListSchema = z.array(presetSchema);

/** GET /role-card-options: the choices the Role card form offers, and how each switch is seen to. */
export const roleCardOptionsSchema = z.object({
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

/** The levels of the engine cascade, least specific first (spec §5.4). */
export const engineCascadeLevelSchema = z.enum([
  "office-default",
  "project-default",
  "role-override",
  "project-role-override",
]);
export type EngineCascadeLevel = z.infer<typeof engineCascadeLevelSchema>;

/** An engine and model a Role runs on, and the level of the cascade they come from. */
export const engineInCascadeSchema = engineModelSchema.extend({ level: engineCascadeLevelSchema });
export type EngineInCascade = z.infer<typeof engineInCascadeSchema>;

/** GET /roles/:key/engine-cascade: what the Role card says applies, for a Role someone fills. */
export const roleEngineCascadeSchema = z.object({
  /** Null while no engine is listed, so nothing runs. */
  outsideProjects: engineInCascadeSchema.nullable(),
  /** Only the Projects whose engine or model differs from `outsideProjects`. */
  elsewhereInProjects: z.array(engineInCascadeSchema.extend({ projectId: z.string() })),
});
export type RoleEngineCascade = z.infer<typeof roleEngineCascadeSchema>;

/**
 * A part of a Role card as its change history names it, down to each capability and switch.
 * `engine` and `model` are named only by entries saved before the card had a Role override.
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
  z.null(),
]);

/**
 * Who proposed a hire or a card change the user applied from a Proposal, by the key of their Role;
 * null when the user wrote it themselves.
 */
const proposedBySchema = z.string().nullable();

/** GET /roles/:key/changes, newest first: the Role's change history, ending with the hire. */
export const roleChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hired"), at: z.iso.datetime(), proposedBy: proposedBySchema }),
  z.object({
    kind: z.literal("card-changed"),
    at: z.iso.datetime(),
    /** The version the change saved. */
    cardVersion: z.number().int().positive(),
    changes: z.array(
      z.object({ field: roleCardFieldSchema, from: roleCardValueSchema, to: roleCardValueSchema }),
    ),
    proposedBy: proposedBySchema,
  }),
  z.object({
    kind: z.literal("skills-changed"),
    at: z.iso.datetime(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
  }),
]);
export type RoleChange = z.infer<typeof roleChangeSchema>;

export const roleChangeListSchema = z.array(roleChangeSchema);

/** What a refused hire or card change answers: every reason, also joined into Nest's `message`. */
export const roleRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type RoleRefusal = z.infer<typeof roleRefusalSchema>;

/** Who wrote a Memory note: the user on the Memory tab, or an Agent in one of its Threads. */
export const memoryNoteSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({
    kind: z.literal("agent"),
    threadId: z.string(),
    taskId: z.string().optional(),
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

/** The People events the web receives; each names the Role, so its queries refresh. */
export const roleWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("role.hired"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.let-go"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.hired-back"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.card-changed"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.avatar-changed"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.memory-changed"), roleKey: z.string() }),
]);
export type RoleWebEvent = z.infer<typeof roleWebEventSchema>;
