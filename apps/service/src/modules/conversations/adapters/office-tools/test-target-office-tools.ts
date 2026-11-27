import {
  DEFAULT_PORT_VARIABLE,
  MEMORY_PER_SERVICE_MEGABYTES,
  entryPointSchema,
  gigabytesOf,
} from "@the-office/contracts";
import { z } from "zod";
import { type ProposedTestTargetFields } from "../../../projects/index.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";

/** A test target as an Office tool takes it, whole. */
export const targetInput = z.object({
  key: z
    .string()
    .describe(
      'The target\'s key: lower-case letters, digits and "-", starting with a letter, at most 40 characters; a new key adds a target, an existing one changes it.',
    ),
  name: z.string().describe("The target's name, as the user reads it."),
  kind: z
    .enum(["hosted", "build-to-install", "install-on-a-device"])
    .describe(
      "hosted: the app runs in the Task's run environment and is opened by its port; build-to-install: a build whose output files the user downloads and installs; install-on-a-device: builds one of the Project's Build to install targets and installs it on one of the Project's Android phones, with buildTargetKey and projectDeviceId and no entry point, variables, commandsBefore or memory of its own.",
    ),
  entryPoint: entryPointSchema
    .optional()
    .describe(
      "Hosted and Build to install only, and required for them: one of the repository's own entry points, never a command line: a file in the repository (repository-file, by its path from the root), a script of a package manifest (package-script), a Gradle task run through the repository's ./gradlew (gradle-task), or a service of the repository's .devcontainer/ (devcontainer-service, Hosted only). Arguments are given one by one and never read by a shell: no pipes, ;, &&, redirections or substitutions.",
    ),
  port: z
    .number()
    .int()
    .optional()
    .describe("Hosted only, and required for it: the port the app listens on."),
  portVariable: z
    .string()
    .default(DEFAULT_PORT_VARIABLE)
    .describe(
      `Hosted only: the variable The Office sets to the port in the app's service, ${DEFAULT_PORT_VARIABLE} when left out; a variable's name (letters, digits and _, not starting with a digit), never OFFICE_TEST_INSTANCE nor one of the target's own variables.`,
    ),
  buildTargetKey: z
    .string()
    .optional()
    .describe(
      "Install on a device only, and required for it: the key of the Project's Build to install target whose build it installs, as it is in the same save.",
    ),
  projectDeviceId: z
    .string()
    .optional()
    .describe(
      "Install on a device only, and required for it: the id of the Project device it installs on, an Android phone, as list_projects lists it under Devices.",
    ),
  outputPatterns: z
    .array(z.string())
    .optional()
    .describe(
      "Build to install only, and required for it: the paths of the build's output files, relative to the repository's root, * and ** allowed.",
    ),
  variables: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .default([])
    .describe(
      "Plain variables the entry point runs with, each with a test value: never the Project's own secrets or credentials.",
    ),
  secretVariables: z
    .array(z.string())
    .default([])
    .describe(
      "The names of the Secret variables it runs with, names only: the user types each value on the Project page after applying the Proposal.",
    ),
  commandsBefore: z
    .array(z.string())
    .default([])
    .describe(
      "The keys of the Project's commands (as list_projects lists them, or install for its install command) The Office runs in the instance's checkout, in this order, before the entry point, such as install then build, since the checkout has nothing installed; none when left out.",
    ),
  memoryMegabytes: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe(
      `The target's own Memory per service, in MB, from ${MEMORY_PER_SERVICE_MEGABYTES.min} (${gigabytesOf(MEMORY_PER_SERVICE_MEGABYTES.min)}) to ${MEMORY_PER_SERVICE_MEGABYTES.max} (${gigabytesOf(MEMORY_PER_SERVICE_MEGABYTES.max)}) in steps of ${MEMORY_PER_SERVICE_MEGABYTES.step}; null or left out for the Office-wide setting.`,
    ),
});

export type TargetInput = z.infer<typeof targetInput>;

/** Each target as Projects takes it, refused when it lacks its kind's own field. */
export function proposedTargets(targets: readonly TargetInput[]): ProposedTestTargetFields[] {
  const problems: string[] = [];
  const proposed = targets.flatMap((target): ProposedTestTargetFields[] => {
    const { key, name, entryPoint, variables, secretVariables, commandsBefore, memoryMegabytes } =
      target;
    if (target.kind === "install-on-a-device") {
      const { buildTargetKey, projectDeviceId } = target;
      if (buildTargetKey === undefined || projectDeviceId === undefined) {
        problems.push(
          `Test target "${key}" is Install on a device, so it needs buildTargetKey and projectDeviceId.`,
        );
        return [];
      }
      return [{ key, name, kind: "install-on-a-device", buildTargetKey, projectDeviceId }];
    }
    if (entryPoint === undefined) {
      problems.push(`Test target "${key}" needs an entryPoint.`);
      return [];
    }
    const fields = {
      key,
      name,
      entryPoint,
      variables,
      secretVariables,
      commandsBefore,
      memoryMegabytes,
    };
    if (target.kind === "hosted") {
      if (target.port === undefined) {
        problems.push(`Test target "${key}" is Hosted, so it needs a port.`);
        return [];
      }
      return [{ ...fields, kind: "hosted", port: target.port, portVariable: target.portVariable }];
    }
    if (target.outputPatterns === undefined) {
      problems.push(`Test target "${key}" is Build to install, so it needs outputPatterns.`);
      return [];
    }
    return [{ ...fields, kind: "build-to-install", outputPatterns: target.outputPatterns }];
  });
  if (problems.length > 0) throw new ProposalRefused(problems);
  return proposed;
}
