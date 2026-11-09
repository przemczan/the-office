import { z } from "zod";
import { webEventSchema } from "./events.js";
import { runEnvironmentSettingSchema } from "./projects.js";
import { taskStateSchema } from "./work.js";

/** What the user picks for a Project's Run environment (PUT /projects/:id/run-environment). */
export const runEnvironmentChangeSchema = z.object({ runEnvironment: z.enum(["on", "off"]) });
export type RunEnvironmentChange = z.infer<typeof runEnvironmentChangeSchema>;

/** The repository's .devcontainer/ on the base branch's last commit fetched. */
export const runEnvironmentDefinitionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("not-found") }),
  z.object({ state: z.literal("valid") }),
  z.object({ state: z.literal("not-valid"), problems: z.array(z.string()).min(1) }),
]);
export type RunEnvironmentDefinition = z.infer<typeof runEnvironmentDefinitionSchema>;

/** The Project's open "Set up the run environment" Task. */
export const runEnvironmentSetUpTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: taskStateSchema,
});
export type RunEnvironmentSetUpTask = z.infer<typeof runEnvironmentSetUpTaskSchema>;

/**
 * A Project's run environment (GET /projects/:id/run-environment, and what PUT and
 * POST …/set-up answer): the setting, the definition, and the set-up Task.
 */
export const projectRunEnvironmentSchema = z.object({
  runEnvironment: runEnvironmentSettingSchema,
  definition: runEnvironmentDefinitionSchema,
  /** Why the last set-up Task's Done left the setting as it was; empty otherwise. */
  setUpProblems: z.array(z.string()),
  /** Null while the Project has no open set-up Task. */
  setUpTask: runEnvironmentSetUpTaskSchema.nullable(),
});
export type ProjectRunEnvironment = z.infer<typeof projectRunEnvironmentSchema>;

/**
 * The run environments' CPU limit: Automatic follows this computer's cores, Fixed puts one number
 * on every service. The fixed number is kept while Automatic is chosen.
 */
export const cpuLimitChoiceSchema = z.enum(["automatic", "fixed"]);
export type CpuLimitChoice = z.infer<typeof cpuLimitChoiceSchema>;

/**
 * What Settings saves (PUT /settings/run-environment-cpu-limit). The service also refuses a fixed
 * number above this computer's cores.
 */
export const cpuLimitChangeSchema = z.object({
  cpuLimit: cpuLimitChoiceSchema,
  fixedCpus: z.int().min(1),
});
export type CpuLimitChange = z.infer<typeof cpuLimitChangeSchema>;

/** The CPU limit and what Automatic gives on this computer (GET, and what PUT answers). */
export const runEnvironmentCpuLimitSchema = cpuLimitChangeSchema.extend({
  hostCores: z.int().min(1),
  automatic: z.object({
    /** The checks' service's CPUs. */
    checksCpus: z.int().min(1),
    /** Every other service's CPUs, such as Postgres. */
    otherServicesCpus: z.int().min(1),
  }),
});
export type RunEnvironmentCpuLimit = z.infer<typeof runEnvironmentCpuLimitSchema>;

/** The CPU limit changed: Settings › Office limits reads it again. */
export const runEnvironmentWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("run-environment-cpu-limit.changed") }),
]);
export type RunEnvironmentWebEvent = z.infer<typeof runEnvironmentWebEventSchema>;
