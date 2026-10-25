import { z } from "zod";
import { webEventSchema } from "./events.js";

/** The engines a Role may work with. */
export const engineSchema = z.enum(["agent-sdk"]);
export type Engine = z.infer<typeof engineSchema>;

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
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

/** Which commands an Agent may run; read-only git under each. */
export const runPermissionSchema = z.enum(["read-only-git", "project-commands", "anything"]);
export type RunPermission = z.infer<typeof runPermissionSchema>;

export const permissionProfileSchema = z.object({
  edit: z.boolean(),
  run: runPermissionSchema,
  web: z.boolean(),
});
export type PermissionProfile = z.infer<typeof permissionProfileSchema>;

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

export const hardSwitchesSchema = z.object({
  runInstalls: hardSwitchValueSchema,
  publishOutsideThePipeline: hardSwitchValueSchema,
  changeRoles: hardSwitchValueSchema,
});
export type HardSwitches = z.infer<typeof hardSwitchesSchema>;

/** A number of Tasks at once, or "none": the person only talks. */
export const taskLimitSchema = z.union([z.number(), z.literal("none")]);
export type TaskLimit = z.infer<typeof taskLimitSchema>;

/** PUT /roles/:key/card: everything the user edits on a Role card. */
export const roleCardEditSchema = z.object({
  name: z.string(),
  title: z.string(),
  responsibilities: z.string(),
  instructions: z.string(),
  engine: engineSchema,
  /** One of the engine's models, by its id. */
  model: z.string(),
  effort: effortSchema,
  capabilities: capabilitiesSchema,
  hardSwitches: hardSwitchesSchema,
  taskLimit: taskLimitSchema,
  sessionDefault: sessionDefaultSchema,
});
export type RoleCardEdit = z.infer<typeof roleCardEditSchema>;

/** The permission profile is read-only until tier 2. */
export const roleCardSchema = roleCardEditSchema.extend({
  permissionProfile: permissionProfileSchema,
});
export type RoleCard = z.infer<typeof roleCardSchema>;

/** A Role someone fills, by the key Pipelines and Consult values name it by. */
export const roleSchema = z.object({
  key: z.string().min(1),
  card: roleCardSchema,
  /** The version sessions start with now, from 1. */
  cardVersion: z.number().int().positive(),
  hiredAt: z.iso.datetime(),
  cardSavedAt: z.iso.datetime(),
  /** The switches whose Consult value names a Role nobody fills, so they ask the user for now. */
  askingYouUntilHired: z.array(hardSwitchKeySchema),
});
export type Role = z.infer<typeof roleSchema>;

export const roleListSchema = z.array(roleSchema);

/** POST /roles: hires a person into the Role of the preset keyed `roleKey`. */
export const hireSchema = z.object({ roleKey: z.string(), name: z.string() });
export type Hire = z.infer<typeof hireSchema>;

/** GET /presets: what hiring starts from. */
export const presetSchema = z.object({
  roleKey: z.string(),
  suggestedName: z.string(),
  card: roleCardSchema.omit({ name: true }),
});
export type Preset = z.infer<typeof presetSchema>;

export const presetListSchema = z.array(presetSchema);

/** GET /role-card-options: the choices the Role card form offers, and how each switch is seen to. */
export const roleCardOptionsSchema = z.object({
  engines: z.array(z.object({ engine: engineSchema, models: z.array(z.string()) })),
  /** Every Role a Consult value may name, hired or not. */
  knownRoles: z.array(z.object({ key: z.string(), title: z.string() })),
  hardSwitches: z.array(
    z.object({ key: hardSwitchKeySchema, enforcement: z.enum(["enforced", "followed"]) }),
  ),
  taskLimits: z.object({ lowest: z.number().int(), highest: z.number().int() }),
});
export type RoleCardOptions = z.infer<typeof roleCardOptionsSchema>;

/** A part of a Role card as its change history names it, down to each capability and switch. */
export const roleCardFieldSchema = z.enum([
  "name",
  "title",
  "responsibilities",
  "instructions",
  "engine",
  "model",
  "effort",
  "taskLimit",
  "sessionDefault",
  "capabilities.sharedMemory",
  "capabilities.chat",
  "capabilities.consultant",
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
]);

/** GET /roles/:key/card-versions, newest first: the change history, the first being the hire. */
export const roleCardVersionSchema = z.object({
  version: z.number().int().positive(),
  savedAt: z.iso.datetime(),
  /** From the version before; empty for the first. */
  changes: z.array(
    z.object({ field: roleCardFieldSchema, from: roleCardValueSchema, to: roleCardValueSchema }),
  ),
});
export type RoleCardVersion = z.infer<typeof roleCardVersionSchema>;

export const roleCardVersionListSchema = z.array(roleCardVersionSchema);

/** What a refused hire or card change answers: every reason, also joined into Nest's `message`. */
export const roleRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type RoleRefusal = z.infer<typeof roleRefusalSchema>;

/** The People events the web receives; each names the Role, so its queries refresh. */
export const roleWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("role.hired"), roleKey: z.string() }),
  webEventSchema.extend({ type: z.literal("role.card-changed"), roleKey: z.string() }),
]);
export type RoleWebEvent = z.infer<typeof roleWebEventSchema>;
