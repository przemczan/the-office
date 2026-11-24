import { Injectable, type OnModuleInit } from "@nestjs/common";
import { projectCommandSchema } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry, type OfficeToolResult } from "../../../engine/index.js";
import { RoleCards } from "../../../people/index.js";
import {
  ProjectActions,
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  RunEnvironmentSwitchRegistry,
  TestTargets,
  proposedCommands,
  type Action,
  type ActionFields,
  type EditedTestTarget,
  type SettingChangedBy,
  type TestTarget,
} from "../../../projects/index.js";
import { HeldCalls } from "../../application/held-calls.js";
import { canonicalCall } from "../../domain/canonical-call.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import {
  CHANGE_ACTIONS_TOOL,
  CHANGE_ENVIRONMENT_VARIABLES_TOOL,
  CHANGE_PROJECT_COMMANDS_TOOL,
  CHANGE_RUN_ENVIRONMENT_TOOL,
  CHANGE_TEST_TARGETS_TOOL,
  PROPOSE_ACTIONS_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
} from "../../domain/session-instructions.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { actionInputWith } from "./action-office-tools.js";
import { proposedTargets, targetInput } from "./test-target-office-tools.js";

type Project = Awaited<ReturnType<ProjectService["read"]>>;

/** What every one of these tools' descriptions ends with. */
const HELD = `Your Change Project settings Hard switch decides whether it runs, is refused, or waits for approval. When it waits, end your turn: the answer comes as your next message, and after "Allow once" you repeat the same call, word for word, which then runs once. These settings stay the user's, through the propose_* tools or the Project page: Secret variables' values, the Publishing mode, Before and After publishing, Delete branches once merged, GitHub issues write-back, Server values, the Engine, Actions that leave the workstation, Project Pipelines and the Default Pipeline.`;

const PROJECT = z.string().describe("The Project's id, as list_projects gives it.");
const WHY = z.string().describe("Why the setting should change, in a sentence.");

const SECRET_VALUES_ARE_THE_USERS =
  "Secret variables' values are the user's: they type them on the Project page.";

/** A call the switch held, as the tool runs it once it may: what it changes and what it answers. */
interface SettingCall {
  readonly sessionId: string;
  readonly project: Project;
  /** The setting, as the approval names it, such as "Run environment". */
  readonly setting: string;
  /** The input, without the Project and why, as the approval shows it. */
  readonly input: unknown;
  readonly why: string;
  run(by: SettingChangedBy): Promise<string>;
}

/**
 * The Office tools that change a Project's everyday settings (spec §6, "Project settings by
 * Agents"): its Run environment, commands, test targets, Actions and Environment variables, held by
 * the Change Project settings Hard switch, which The Office sees to in code. Each reads the Project
 * first, then holds the call, then changes the setting through the same method the Project page
 * does, recorded as made by the session's person on its Task; the settings that stay the user's are
 * refused, pointing to the Proposal tools and the Project page.
 */
@Injectable()
export class ProjectSettingOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly projects: ProjectService,
    private readonly testTargets: TestTargets,
    private readonly actions: ProjectActions,
    private readonly runEnvironments: RunEnvironmentSwitchRegistry,
    private readonly heldCalls: HeldCalls,
    private readonly threads: ThreadRepository,
    private readonly roleCards: RoleCards,
  ) {}

  onModuleInit(): void {
    this.registerRunEnvironment();
    this.registerCommands();
    this.registerTestTargets();
    this.registerActions();
    this.registerEnvironmentVariables();
  }

  private registerRunEnvironment(): void {
    this.registry.register({
      name: CHANGE_RUN_ENVIRONMENT_TOOL,
      description: `Turns a Project's Run environment On or Off: On, its checks and Agents' commands run in the Task's run environment built from the base branch's .devcontainer/, which must be valid as the base branch is fetched now. ${HELD}`,
      input: z.object({
        project: PROJECT,
        runEnvironment: z.enum(["on", "off"]).describe("on or off."),
        why: WHY,
      }),
      run: ({ project, runEnvironment, why }, { sessionId }) =>
        this.withProject(project, (found) =>
          this.held({
            sessionId,
            project: found,
            setting: "Run environment",
            input: { runEnvironment },
            why,
            run: async (by) => {
              await this.runEnvironments.change(found.id, runEnvironment, by);
              return `Changed: ${found.name}'s Run environment is ${runEnvironment === "on" ? "On" : "Off"}.`;
            },
          }),
        ),
    });
  }

  private registerCommands(): void {
    this.registry.register({
      name: CHANGE_PROJECT_COMMANDS_TOOL,
      description: `Changes a Project's install command, install inputs and commands, all or nothing, by the Project page's rules. ${HELD}`,
      input: z.object({
        project: PROJECT,
        install: z
          .string()
          .optional()
          .describe("The install command, as one command line for the platform's shell."),
        installInputs: z
          .array(z.string())
          .optional()
          .describe(
            "The whole list of paths inside the repository whose change makes a worktree install again.",
          ),
        commands: z
          .object({
            add: z
              .array(projectCommandSchema)
              .optional()
              .describe(
                'Commands to add, each whole: a key (lower-case letters, digits and "-", starting with a letter; not install or publish), a name, a kind (build, lint or test), one command line, and for a test command a re-run command, blank for none.',
              ),
            change: z
              .array(projectCommandSchema)
              .optional()
              .describe("Commands to change by their key, each given whole."),
            remove: z.array(z.string()).optional().describe("The keys of the commands to remove."),
          })
          .optional(),
        beforePublishingCommand: z
          .string()
          .optional()
          .describe(
            `Never given here: Before publishing is the user's (${PROPOSE_PROJECT_COMMANDS_TOOL} or the Project page).`,
          ),
        afterPublishingCommand: z
          .string()
          .optional()
          .describe(
            `Never given here: After publishing is the user's (${PROPOSE_PROJECT_COMMANDS_TOOL} or the Project page).`,
          ),
        why: WHY,
      }),
      run: (
        {
          project,
          install,
          installInputs,
          commands,
          beforePublishingCommand,
          afterPublishingCommand,
          why,
        },
        { sessionId },
      ) =>
        this.withProject(project, async (found) => {
          if (beforePublishingCommand !== undefined || afterPublishingCommand !== undefined) {
            return refusal(
              `Before and After publishing are the user's: draft them with ${PROPOSE_PROJECT_COMMANDS_TOOL}, or the user changes them on the Project page.`,
            );
          }
          const misplaced = misplacedCommands(found, commands);
          if (misplaced.length > 0) return refusal(misplaced.join(" "));
          return this.held({
            sessionId,
            project: found,
            setting: "commands",
            input: { install, installInputs, commands },
            why,
            run: async (by) => {
              await this.projects.changeCommandsAsProposed(
                found.id,
                proposedCommands(found, {
                  installCommand: install,
                  installInputs,
                  commands: [...(commands?.add ?? []), ...(commands?.change ?? [])],
                  removeCommands: commands?.remove,
                }),
                by,
              );
              return `Changed: ${found.name}'s commands.`;
            },
          });
        }),
    });
  }

  private registerTestTargets(): void {
    this.registry.register({
      name: CHANGE_TEST_TARGETS_TOOL,
      description: `Changes a Project's test targets, all or nothing, by the Project page's rules: targets to add or change by key, each given whole, and targets to remove; the others stay. Secret variables go by name only: a value already set is kept, and the user types a new one on the Project page. ${HELD}`,
      input: z.object({
        project: PROJECT,
        targets: z
          .array(
            targetInput.extend({
              secretVariables: z
                .array(z.string())
                .default([])
                .describe(
                  "The names of the Secret variables it runs with, names only: a value set is kept; the user types a new one's value on the Project page.",
                ),
            }),
          )
          .default([])
          .describe("Targets to add, or to change by their key, each whole."),
        removeTargets: z
          .array(z.string())
          .default([])
          .describe("The keys of the targets to remove."),
        why: WHY,
      }),
      run: ({ project, targets, removeTargets, why }, { sessionId }) =>
        this.withProject(project, (found) => {
          // Each target lacking its kind's own field is refused before anyone is asked.
          const given = proposedTargets(targets).map((target): EditedTestTarget => ({
            ...target,
            secretVariables: target.secretVariables.map((name) => ({ name })),
          }));
          return this.held({
            sessionId,
            project: found,
            setting: "test targets",
            input: { targets, removeTargets },
            why,
            run: async (by) => {
              const stored = await this.testTargets.list(found.id);
              await this.testTargets.change(
                found.id,
                editedList(stored.map(asEdited), given, removeTargets),
                null,
                by,
              );
              return `Changed: ${found.name}'s test targets.`;
            },
          });
        }),
    });
  }

  private registerActions(): void {
    this.registry.register({
      name: CHANGE_ACTIONS_TOOL,
      description: `Changes a Project's Actions, all or nothing, by the Project page's rules: Actions to add or change by key, each given whole, and Actions to remove; the others stay. An Action that leaves the workstation is the user's: adding one, changing or removing one marked so, and setting or clearing the mark are refused (${PROPOSE_ACTIONS_TOOL}). ${HELD}`,
      input: z.object({
        project: PROJECT,
        actions: z
          .array(
            actionInputWith(
              z
                .boolean()
                .default(false)
                .describe(
                  `Always false here: an Action that pushes, publishes, deploys or releases leaves the workstation, and is the user's (${PROPOSE_ACTIONS_TOOL}).`,
                ),
            ),
          )
          .default([])
          .describe("Actions to add, or to change by their key, each whole."),
        removeActions: z
          .array(z.string())
          .default([])
          .describe("The keys of the Actions to remove; removing one removes its runs."),
        why: WHY,
      }),
      run: ({ project, actions, removeActions, why }, { sessionId }) =>
        this.withProject(project, async (found) => {
          const given: readonly ActionFields[] = actions;
          const stored = await this.actions.list(found.id);
          const leaving = leavingTheWorkstation(stored, given, removeActions);
          if (leaving.length > 0) return refusal(leaving.join(" "));
          return this.held({
            sessionId,
            project: found,
            setting: "Actions",
            input: { actions, removeActions },
            why,
            run: async (by) => {
              const now = await this.actions.list(found.id);
              const again = leavingTheWorkstation(now, given, removeActions);
              if (again.length > 0) throw new ProjectRefused(again);
              await this.actions.change(
                found.id,
                editedList(now.map(withoutSetBy), given, removeActions),
                null,
                by,
              );
              return `Changed: ${found.name}'s Actions.`;
            },
          });
        }),
    });
  }

  private registerEnvironmentVariables(): void {
    this.registry.register({
      name: CHANGE_ENVIRONMENT_VARIABLES_TOOL,
      description: `Changes a Project's Environment variables: the plain variables its commands and Agents run with, the inherited variables removed, and the folders put in front of PATH, each list given whole; a list left out stays. Secret variables are the user's and stay as they are: this never sets, changes or reads one. ${HELD}`,
      input: z.object({
        project: PROJECT,
        variables: z
          .array(
            z.object({
              name: z.string(),
              value: z.string(),
              secret: z
                .boolean()
                .optional()
                .describe("Never true: Secret variables are the user's, on the Project page."),
            }),
          )
          .optional()
          .describe(
            "Every plain variable, whole: they replace the plain ones the Project has now. The Secret variables stay.",
          ),
        unset: z
          .array(z.string())
          .optional()
          .describe("The whole list of inherited variables to remove, by name."),
        prependPath: z
          .array(z.string())
          .optional()
          .describe("The whole list of folders put in front of PATH, in order, each absolute."),
        why: WHY,
      }),
      run: ({ project, variables, unset, prependPath, why }, { sessionId }) =>
        this.withProject(project, async (found) => {
          const secrets = found.environment.set.filter(({ secret }) => secret);
          const secretGiven = (variables ?? []).filter(
            ({ name, secret }) =>
              secret === true || secrets.some((each) => each.name === name.trim()),
          );
          if (secretGiven.length > 0) {
            return refusal(
              `${secretGiven.map(({ name }) => name.trim()).join(", ")}: ${SECRET_VALUES_ARE_THE_USERS} This tool keeps the Secret variables as they are.`,
            );
          }
          const plain = variables?.map(({ name, value }) => ({ name, value }));
          return this.held({
            sessionId,
            project: found,
            setting: "Environment variables",
            input: { variables: plain, unset, prependPath },
            why,
            run: async (by) => {
              const now = (await this.projects.read(found.id)).environment;
              await this.projects.changeEnvironment(
                found.id,
                {
                  // Each Secret variable goes without its value, which keeps the Project's own.
                  set: [
                    ...now.set
                      .filter(({ secret }) => secret)
                      .map(({ name }) => ({ name, secret: true as const })),
                    ...(plain ?? now.set.filter(({ secret }) => !secret)).map(
                      ({ name, value }) => ({ name, value, secret: false as const }),
                    ),
                  ],
                  unset: unset ?? now.unset,
                  prependPath: prependPath ?? now.prependPath,
                },
                by,
              );
              return `Changed: ${found.name}'s Environment variables.`;
            },
          });
        }),
    });
  }

  /** Runs `work` on the Project, answering a refusal of Projects in its words. */
  private async withProject(
    projectId: string,
    work: (project: Project) => Promise<OfficeToolResult>,
  ): Promise<OfficeToolResult> {
    try {
      const project = await this.projects.find(projectId.trim());
      if (!project) return refusal(`The Office has no Project "${projectId}".`);
      return await work(project);
    } catch (error) {
      // FeatureSwitchedOff is a ProjectRefused, so a switched-off Project is refused in its words.
      if (error instanceof ProjectRefused || error instanceof ProposalRefused) {
        return refusal(error.message);
      }
      if (error instanceof ProjectNotFound) return refusal(error.message);
      throw error;
    }
  }

  /**
   * Holds the call behind Change Project settings, on a Task only, where a held call has a Thread
   * to wait in and the change a Task to be recorded on; runs it once it may.
   */
  private async held(call: SettingCall): Promise<OfficeToolResult> {
    const thread = await this.threads.findBySession(call.sessionId);
    if (thread?.home.kind !== "task") {
      return refusal("A Project's settings change only from a Thread on a Task.");
    }
    const { taskId } = thread.home;
    const outcome = await this.heldCalls.hold({
      sessionId: call.sessionId,
      switchKey: "changeProjectSettings",
      call: `Change ${call.setting} of the Project ${call.project.name} to: ${canonicalCall(call.input)}`,
      context: `${call.why}\n\nIt changes ${call.setting} of ${call.project.name} as the Project page would, recorded in its Recent activity.`,
      why: call.why,
    });
    if (outcome.kind === "refused") return refusal(outcome.reason);
    if (outcome.kind === "held") {
      return {
        text: `The call waits on ${outcome.waitingOn}, as a Decision in this Thread. End your turn now: their answer comes as your next message.`,
        isError: false,
      };
    }
    const person = await this.roleCards.find(outcome.roleKey);
    const by: SettingChangedBy = {
      kind: "person",
      roleKey: outcome.roleKey,
      name: person?.card.name ?? outcome.roleKey,
      title: person?.card.title ?? outcome.roleKey,
      taskId,
    };
    return { text: await call.run(by), isError: false };
  }
}

function refusal(text: string): OfficeToolResult {
  return { text, isError: true };
}

/** Each command added that the Project has, or changed or removed that it hasn't. */
function misplacedCommands(
  project: Project,
  commands:
    | {
        readonly add?: readonly { key: string }[];
        readonly change?: readonly { key: string }[];
        readonly remove?: readonly string[];
      }
    | undefined,
): string[] {
  const has = (key: string) => project.commands.some((command) => command.key === key.trim());
  return [
    ...(commands?.add ?? [])
      .filter(({ key }) => has(key))
      .map(({ key }) => `The Project has a ${key.trim()} command already: give it under change.`),
    ...[...(commands?.change ?? []).map(({ key }) => key), ...(commands?.remove ?? [])]
      .filter((key) => !has(key))
      .map((key) => `The Project has no command with the key "${key.trim()}".`),
  ];
}

/** The list now, each given by key in its place or added at the end, and those removed left out. */
function editedList<Item extends { readonly key: string }>(
  now: readonly Item[],
  given: readonly Item[],
  removed: readonly string[],
): Item[] {
  const byKey = new Map(given.map((item) => [item.key.trim(), item]));
  const gone = new Set(removed.map((key) => key.trim()));
  const kept = now.filter(({ key }) => !gone.has(key)).map((item) => byKey.get(item.key) ?? item);
  const added = given.filter(
    (item) => !now.some(({ key }) => key === item.key.trim()) && !gone.has(item.key.trim()),
  );
  return [...kept, ...added];
}

/** A target as the page sends it back: its Secret variables by name, each keeping its value. */
function asEdited({ setBy: _setBy, ...target }: TestTarget): EditedTestTarget {
  return { ...target, secretVariables: target.secretVariables.map(({ name }) => ({ name })) };
}

function withoutSetBy({ setBy: _setBy, ...action }: Action): ActionFields {
  return action;
}

/**
 * Why the change reaches an Action that leaves the workstation, which is the user's: one added or
 * changed marked so, or that becomes a Workflow (always marked), and one marked now changed or
 * removed.
 */
function leavingTheWorkstation(
  stored: readonly Action[],
  given: readonly ActionFields[],
  removed: readonly string[],
): string[] {
  const advice = `Actions that leave the workstation are the user's: draft the change with ${PROPOSE_ACTIONS_TOOL}, or the user makes it on the Project page.`;
  const problems = [
    ...given.flatMap((action) => {
      const key = action.key.trim();
      const before = stored.find((each) => each.key === key);
      if (before?.leavesTheWorkstation) return [`Action "${key}" leaves the workstation.`];
      if (action.leavesTheWorkstation) return [`Action "${key}" would leave the workstation.`];
      if (action.kind === "workflow" && before?.kind !== "workflow") {
        return [`Action "${key}" would be a Workflow, which leaves the workstation.`];
      }
      return [];
    }),
    ...removed
      .map((key) => key.trim())
      .filter((key) => stored.some((each) => each.key === key && each.leavesTheWorkstation))
      .map((key) => `Action "${key}" leaves the workstation.`),
  ];
  return problems.length > 0 ? [...problems, advice] : [];
}
