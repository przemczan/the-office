import { z } from "zod";
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
