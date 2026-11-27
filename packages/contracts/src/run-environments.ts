import { z } from "zod";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";
import { runEnvironmentSettingSchema } from "./projects.js";
import { offBoardTaskStartSchema, taskStateSchema } from "./work.js";

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
 * POST /projects/:id/run-environment/set-up: the run environment after it, and the start of its
 * "Set up the run environment" Off-board Task; null when a valid definition turned it On at once.
 */
export const runEnvironmentSetUpAnswerSchema = z.object({
  runEnvironment: projectRunEnvironmentSchema,
  start: offBoardTaskStartSchema.nullable(),
});
export type RunEnvironmentSetUpAnswer = z.infer<typeof runEnvironmentSetUpAnswerSchema>;

/** Office action: Set up run environment. */
export const SET_UP_RUN_ENVIRONMENT_ACTION = officeAction({
  name: "set_up_run_environment",
  title: "Set up a Project's run environment",
  description:
    "Sets up the Project's run environment: turns it On at once when its base branch holds a valid .devcontainer/ definition, else starts the Project's \"Set up the run environment\" Task, or queues it.",
  input: z.object({ projectId: z.string().min(1).describe("The id of the Project.") }),
  answer: runEnvironmentSetUpAnswerSchema,
  route: { method: "POST", path: "/projects/:projectId/run-environment/set-up" },
  status: 201,
  area: "projectsAndSettings",
  group: "projectSettings",
  subject: ({ projectId }) => ({ kind: "project", id: projectId }),
});

/**
 * The run environments' CPU limit: Automatic follows this computer's cores, Fixed puts one number
 * on every service. The fixed number is kept while Automatic is chosen.
 */
export const cpuLimitChoiceSchema = z.enum(["automatic", "fixed"]);
export type CpuLimitChoice = z.infer<typeof cpuLimitChoiceSchema>;

/** The bounds of a run environments' Office limit, which the Stepper offers and the service keeps. */
export interface RunEnvironmentLimitBounds {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** Settings › Office limits: how many run environments may be running together. */
export const RUN_ENVIRONMENTS_AT_ONCE: RunEnvironmentLimitBounds = { min: 1, max: 12, step: 1 };
/** Settings › Office limits: the memory each service of a run environment may use, in MB. */
export const MEMORY_PER_SERVICE_MEGABYTES: RunEnvironmentLimitBounds = {
  min: 512,
  max: 65_536,
  step: 512,
};
/** Settings › Office limits: the processes each service of a run environment may run. */
export const PROCESSES_PER_SERVICE: RunEnvironmentLimitBounds = {
  min: 256,
  max: 65_536,
  step: 256,
};

/** Memory as Settings shows it: megabytes in GB, such as "4 GB" or "0.5 GB". */
export function gigabytesOf(megabytes: number): string {
  return `${megabytes / 1024} GB`;
}

const FIXED_CPUS_ERROR = "A fixed CPU limit is a whole number of at least 1.";

/** A whole number inside its bounds and on its steps; anything else is refused with `error`. */
function boundedLimitSchema(bounds: RunEnvironmentLimitBounds, error: string) {
  return z
    .int({ error })
    .min(bounds.min, { error })
    .max(bounds.max, { error })
    .multipleOf(bounds.step, { error });
}

/**
 * What Settings saves (PUT /settings/run-environments), the whole set at once. The service also
 * refuses a fixed CPU number above this computer's cores.
 */
export const runEnvironmentOfficeLimitsChangeSchema = z.object({
  runEnvironmentsAtOnce: boundedLimitSchema(
    RUN_ENVIRONMENTS_AT_ONCE,
    `Run environments at once is a whole number between ${RUN_ENVIRONMENTS_AT_ONCE.min} and ` +
      `${RUN_ENVIRONMENTS_AT_ONCE.max}.`,
  ),
  cpuLimit: cpuLimitChoiceSchema,
  fixedCpus: z.int({ error: FIXED_CPUS_ERROR }).min(1, { error: FIXED_CPUS_ERROR }),
  memoryMegabytes: boundedLimitSchema(
    MEMORY_PER_SERVICE_MEGABYTES,
    `Memory per service is between ${gigabytesOf(MEMORY_PER_SERVICE_MEGABYTES.min)} and ` +
      `${gigabytesOf(MEMORY_PER_SERVICE_MEGABYTES.max)}, in steps of ` +
      `${gigabytesOf(MEMORY_PER_SERVICE_MEGABYTES.step)}.`,
  ),
  processes: boundedLimitSchema(
    PROCESSES_PER_SERVICE,
    `Processes per service is between ${PROCESSES_PER_SERVICE.min} and ` +
      `${PROCESSES_PER_SERVICE.max}, in steps of ${PROCESSES_PER_SERVICE.step}.`,
  ),
});
export type RunEnvironmentOfficeLimitsChange = z.infer<
  typeof runEnvironmentOfficeLimitsChangeSchema
>;

/**
 * The run environments' Office limits and what Automatic gives on this computer (GET, and what
 * PUT answers).
 */
export const runEnvironmentOfficeLimitsSchema = runEnvironmentOfficeLimitsChangeSchema.extend({
  hostCores: z.int().min(1),
  automatic: z.object({
    /** The checks' service's CPUs. */
    checksCpus: z.int().min(1),
    /** Every other service's CPUs, such as Postgres. */
    otherServicesCpus: z.int().min(1),
  }),
});
export type RunEnvironmentOfficeLimits = z.infer<typeof runEnvironmentOfficeLimitsSchema>;

/** The run environments' Office limits changed: Settings › Office limits reads them again. */
export const runEnvironmentWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("run-environment-settings.changed") }),
]);
export type RunEnvironmentWebEvent = z.infer<typeof runEnvironmentWebEventSchema>;
