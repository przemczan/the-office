import { ACTION_NAME_MAX_LENGTH, ACTION_TIME_LIMIT_MINUTES } from "@the-office/contracts";
import { z } from "zod";

/**
 * An Action as an Office tool takes it, whole, its Leaves the workstation as `leavesTheWorkstation`
 * describes it to the tool's Agent.
 */
export function actionInputWith<Leaves extends z.ZodType<boolean>>(leavesTheWorkstation: Leaves) {
  const head = {
    key: z
      .string()
      .describe(
        "The Action's key: lower-case letters, digits and \"-\", starting with a letter, as a Project command's; a new key adds an Action, an existing one changes it. Fixed once added.",
      ),
    name: z
      .string()
      .describe(
        `The Action's name, as the user reads it on the Project page, at most ${ACTION_NAME_MAX_LENGTH} characters, such as "Install on my phone" or "Release".`,
      ),
    leavesTheWorkstation,
  };
  return z.discriminatedUnion("kind", [
    z.object({
      ...head,
      kind: z
        .literal("project-command")
        .describe("Runs one of the Project's commands, in a checkout of its own."),
      settings: z.object({
        commandKey: z
          .string()
          .describe(
            "The key of the Project's command it runs, as list_projects lists it; never a command line.",
          ),
        commandsBefore: z
          .array(z.string())
          .default([])
          .describe(
            "The keys of the Project's commands (or install for its install command) run before it, in this order, since the checkout has nothing installed; none when left out.",
          ),
        timeLimitMinutes: z
          .number()
          .int()
          .nullable()
          .default(null)
          .describe(
            `Its own time limit in minutes, ${ACTION_TIME_LIMIT_MINUTES.min} to ${ACTION_TIME_LIMIT_MINUTES.max}; null or left out for the default ${ACTION_TIME_LIMIT_MINUTES.default}.`,
          ),
        projectDeviceId: z
          .string()
          .nullable()
          .default(null)
          .describe(
            "The id of one of the Project's devices, as list_projects lists them under Devices, which its run holds for the whole run, so another run or instance can't use it meanwhile; null or left out for none.",
          ),
      }),
    }),
    z.object({
      ...head,
      kind: z
        .literal("test-target")
        .describe("Launches one of the Project's test targets, such as a Build to install."),
      settings: z.object({
        targetKey: z.string().describe("The key of the Project's test target it launches."),
      }),
    }),
    z.object({
      ...head,
      kind: z
        .literal("workflow")
        .describe(
          "Starts one of the repository's Workflows that declares a start by hand (workflow_dispatch), on the code host.",
        ),
      settings: z.object({
        file: z
          .string()
          .describe(
            "The Workflow's file by its name, as Work › CI lists it, such as release.yml, which the base branch has under .github/workflows/.",
          ),
        inputs: z
          .record(z.string(), z.string())
          .default({})
          .describe(
            "Its inputs by name, each as text (true or false for a yes-no), fixed with the Action and checked against what the file declares; an input left out takes its default.",
          ),
      }),
    }),
  ]);
}
