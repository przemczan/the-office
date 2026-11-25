import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  DEFAULT_PORT_VARIABLE,
  MEMORY_PER_SERVICE_MEGABYTES,
  PROPOSE_TEST_TARGETS_TOOL,
  entryPointSchema,
  gigabytesOf,
} from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import {
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  TestTargets,
  type ProposedTestTargetFields,
} from "../../../projects/index.js";
import { ProposalService } from "../../application/proposal-service.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import { refusedToTheAgent } from "./refused-to-the-agent.js";

const DRAFTED =
  "The Proposal is in this Thread as a card, with each test target's values now and as proposed; nothing changes until the user applies it, and it is refused if those values change first. Don't wait for it: tell the user what you propose and why, in a line or two, and name any Secret variable whose value they type on the Project page once it is applied.";

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

/**
 * The Office tool whoever onboards Projects drafts a change to a Project's test targets with (spec
 * §2.12, "Writing test targets"), a Proposal the user applies with a click. Like every Proposal
 * tool it changes nothing itself, so it sits behind no Hard switch, and returns at once.
 */
@Injectable()
export class TestTargetOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly proposals: ProposalService,
    private readonly projects: ProjectService,
    private readonly testTargets: TestTargets,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PROPOSE_TEST_TARGETS_TOOL,
      description:
        "Drafts a change to a Project's test targets as a Proposal the user applies with a click, all or nothing: targets to add or change by key, each given whole, and targets to remove. It shows in this Thread as a card, with the values now and the ones proposed, and changes nothing until the user applies it. A value the user set changes only when changeUserSet names it. It returns at once. When you have change_project_settings, change the test targets with it instead.",
      input: z.object({
        project: z.string().describe("The Project's id, as list_projects gives it."),
        targets: z
          .array(targetInput)
          .default([])
          .describe("Targets to add, or to change by their key, each whole."),
        removeTargets: z
          .array(z.string())
          .optional()
          .describe("The keys of the targets to remove."),
        changeUserSet: z
          .array(z.string())
          .optional()
          .describe(
            "Each value the user set that this changes on purpose, as key.field, such as web.port; field is one of name, kind, entryPoint, port, portVariable, outputPatterns, variables, secretVariables, commandsBefore, memoryMegabytes, buildTargetKey and projectDeviceId. Removing a target changes each of its values. A value the user set that isn't named here is refused, so read the targets first and name only what you mean to change.",
          ),
      }),
      run: async ({ project: projectId, targets, removeTargets, changeUserSet }, { sessionId }) => {
        const project = await this.projects.find(projectId.trim());
        if (!project) return { text: `The Office has no Project "${projectId}".`, isError: true };
        return refusedToTheAgent(async () => {
          const changes = await this.proposed(project.id, {
            targets: proposedTargets(targets),
            removeTargets,
            changeUserSet,
          });
          await this.proposals.draft(sessionId, {
            kind: "test-targets",
            projectId: project.id,
            changes,
          });
          return DRAFTED;
        });
      },
    });
  }

  private async proposed(
    projectId: string,
    given: Parameters<TestTargets["propose"]>[1],
  ): ReturnType<TestTargets["propose"]> {
    try {
      return await this.testTargets.propose(projectId, given);
    } catch (error) {
      if (error instanceof ProjectRefused) throw new ProposalRefused(error.reasons);
      if (error instanceof ProjectNotFound) throw new ProposalRefused([error.message]);
      throw error;
    }
  }
}

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
