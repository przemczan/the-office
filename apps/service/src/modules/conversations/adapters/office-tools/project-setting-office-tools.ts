import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
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
  isFeatureOn,
  proposedCommands,
  switchedOffWords,
  type Action,
  type ActionFields,
  type EditedTestTarget,
  type ProposedCommands,
  type SettingChangedBy,
  type TestTarget,
} from "../../../projects/index.js";
import { HeldCalls } from "../../application/held-calls.js";
import { canonicalCall } from "../../domain/canonical-call.js";
import { latestWriter } from "../../domain/message.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import {
  CHANGE_PROJECT_SETTINGS_TOOL,
  PROPOSE_ACTIONS_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
} from "../../domain/session-instructions.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { actionInputWith } from "./action-office-tools.js";
import { proposedTargets, targetInput } from "./test-target-office-tools.js";

type Project = Awaited<ReturnType<ProjectService["read"]>>;

const SECRET_VALUES_ARE_THE_USERS =
  "Secret variables' values are the user's: they type them on the Project page.";

const DESCRIPTION = `Changes a Project's everyday settings in one call: give everything a setup needs at once, in the sections it changes, each optional, at least one: environmentVariables, install, installInputs and commands, testTargets, actions, and runEnvironment. They apply in that order, Run environment last; each is changed as the Project page would, recorded in its Recent activity, and if one is refused, those before it stay applied and the answer names them. Your Change Project settings Hard switch decides the whole call: Allowed applies it at once; Ask me holds it as one approval card listing every change, so end your turn: the answer comes as your next message, and after "Allow once" you repeat the same call, word for word, which then applies once; Never refuses it. These stay the user's, so draft them with the Proposal tools (propose_*) or leave them to the Project page: Secret variables' values (only their names go here), the Publishing mode, Before and After publishing (${PROPOSE_PROJECT_COMMANDS_TOOL}), Delete branches once merged, GitHub issues write-back, Server values, the Engine, Actions that leave the workstation (${PROPOSE_ACTIONS_TOOL}), Project Pipelines and the Default Pipeline.`;

const commandsInput = z
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
  .optional()
  .describe("The Project's commands to add, change and remove; the others stay.");

const KIND_WORDS = {
  hosted: "Hosted",
  "build-to-install": "Build to install",
  "install-on-a-device": "Install on a device",
} as const;

const testTargetsInput = z
  .object({
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
    removeTargets: z.array(z.string()).default([]).describe("The keys of the targets to remove."),
  })
  .optional()
  .describe(
    "The Project's test targets, by the Project page's rules: targets to add or change by key, each given whole, and targets to remove; the others stay. Secret variables go by name only: a value already set is kept, and the user types a new one on the Project page.",
  );

const actionsInput = z
  .object({
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
  })
  .optional()
  .describe(
    `The Project's Actions, by the Project page's rules: Actions to add or change by key, each given whole, and Actions to remove; the others stay. An Action that leaves the workstation is the user's: adding one, changing or removing one marked so, and setting or clearing the mark are refused (${PROPOSE_ACTIONS_TOOL}).`,
  );

const environmentVariablesInput = z
  .object({
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
  })
  .optional()
  .describe(
    "The Project's Environment variables: the plain variables its commands and Agents run with, the inherited variables removed, and the folders put in front of PATH, each list given whole; a list left out stays. Secret variables are the user's and stay as they are: this never sets, changes or reads one.",
  );

const input = z.object({
  project: z.string().describe("The Project's id, as list_projects gives it."),
  environmentVariables: environmentVariablesInput,
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
  commands: commandsInput,
  testTargets: testTargetsInput,
  actions: actionsInput,
  runEnvironment: z
    .enum(["on", "off"])
    .optional()
    .describe(
      "The Run environment, on or off, switched at any time: On, each Task's checks and Agents' commands run in its run environment, built from the .devcontainer/ on the Task's own branch, and never on this computer instead; Off, on this computer.",
    ),
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
  why: z.string().describe("Why the settings should change, in a sentence or two."),
});

type Input = z.infer<typeof input>;
type CommandsInput = NonNullable<Input["commands"]>;
type TestTargetsInput = NonNullable<Input["testTargets"]>;
type ActionsInput = NonNullable<Input["actions"]>;
type PlainVariables = {
  readonly variables?: readonly { readonly name: string; readonly value: string }[];
  readonly unset?: readonly string[];
  readonly prependPath?: readonly string[];
};

/**
 * What one call changes, each section left out when it changes nothing: the call's text and its
 * approval are made of these, so no Secret variable's value is in them.
 */
interface Sections {
  readonly environmentVariables?: PlainVariables;
  readonly install?: string;
  readonly installInputs?: readonly string[];
  readonly commands?: CommandsInput;
  readonly testTargets?: TestTargetsInput;
  readonly actions?: ActionsInput;
  readonly runEnvironment?: "on" | "off";
}

/** One section's change, as it applies once the call may run. */
interface Step {
  /** The setting as the answer names it, such as "Run environment". */
  readonly setting: string;
  run(by: SettingChangedBy): Promise<string>;
}

/**
 * The Office tool that changes a Project's everyday settings (spec §6, "Project settings by
 * Agents"): its Environment variables, install and commands, test targets, Actions and Run
 * environment, in one call held by the Change Project settings Hard switch, which The Office sees
 * to in code. It reads the Project and refuses all it can before holding the call, so an approval
 * is never spent on a call refused up front; then applies each section through the same method the
 * Project page does, recorded as made by the session's person on its Task. The settings that stay
 * the user's are refused, pointing to the Proposal tools and the Project page.
 */
@Injectable()
export class ProjectSettingOfficeTools implements OnModuleInit {
  private readonly logger = new Logger(ProjectSettingOfficeTools.name);

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
    this.registry.register({
      name: CHANGE_PROJECT_SETTINGS_TOOL,
      description: DESCRIPTION,
      input,
      run: (given, { sessionId }) =>
        this.withProject(given.project, (found) => this.change(sessionId, found, given)),
    });
  }

  private async change(
    sessionId: string,
    project: Project,
    given: Input,
  ): Promise<OfficeToolResult> {
    if (given.beforePublishingCommand !== undefined || given.afterPublishingCommand !== undefined) {
      return refusal(
        `Before and After publishing are the user's: draft them with ${PROPOSE_PROJECT_COMMANDS_TOOL}, or the user changes them on the Project page.`,
      );
    }
    const secretGiven = secretVariablesGiven(project, given.environmentVariables);
    if (secretGiven.length > 0) {
      return refusal(
        `${secretGiven.join(", ")}: ${SECRET_VALUES_ARE_THE_USERS} This tool keeps the Secret variables as they are.`,
      );
    }
    const sections = sectionsOf(given);
    if (Object.keys(sections).length === 0) {
      return refusal(
        "Nothing to change: give at least one of environmentVariables, install, installInputs, commands, testTargets, actions and runEnvironment.",
      );
    }
    const thread = await this.threads.findBySession(sessionId);
    if (thread?.home.kind !== "task") {
      return refusal("A Project's settings change only from a Thread on a Task.");
    }

    // Every refusal that doesn't need a section applied, before anyone is asked.
    const problems: string[] = [];
    for (const [section, feature] of [
      [sections.testTargets, "test-targets"],
      [sections.actions, "actions"],
    ] as const) {
      if (section && !isFeatureOn(project, feature)) {
        problems.push(switchedOffWords(feature, project.name));
      }
    }
    const commands = this.commandsChange(project, sections);
    if (commands) {
      const misplaced = misplacedCommands(project, sections.commands);
      problems.push(
        ...(misplaced.length > 0
          ? misplaced
          : await this.projects.proposedCommandsProblems(project.id, commands)),
      );
    }
    const targets = sections.testTargets && editedTargets(sections.testTargets, problems);
    const storedTargets = sections.testTargets ? await this.testTargets.list(project.id) : [];
    const storedActions = sections.actions ? await this.actions.list(project.id) : [];
    if (sections.actions) {
      problems.push(
        ...leavingTheWorkstation(
          storedActions,
          sections.actions.actions,
          sections.actions.removeActions,
        ),
      );
    }
    if (problems.length > 0) return refusal(problems.join(" "));

    const outcome = await this.heldCalls.hold({
      sessionId,
      switchKey: "changeProjectSettings",
      call: `Change the settings of the Project ${project.name}: ${canonicalCall(sections)}`,
      context: `${given.why}\n\nIt changes these settings of ${project.name} as the Project page would, each recorded in its Recent activity:\n${approvalLines(
        sections,
        project,
        storedTargets,
        storedActions,
      )
        .map((line) => `- ${line}`)
        .join("\n")}`,
      why: given.why,
    });
    if (outcome.kind === "refused") return refusal(outcome.reason);
    if (outcome.kind === "held") {
      return {
        text: `The call waits on ${outcome.waitingOn}, as one Decision in this Thread listing every change. End your turn now: their answer comes as your next message.`,
        isError: false,
      };
    }
    const person = await this.roleCards.find(outcome.roleKey);
    const writer = latestWriter(await this.threads.messages(thread.id));
    const asked = writer ? { askedBy: { userId: writer.userId, name: writer.name } } : {};
    const by: SettingChangedBy = {
      kind: "person",
      roleKey: outcome.roleKey,
      name: person?.card.name ?? outcome.roleKey,
      title: person?.card.title ?? outcome.roleKey,
      taskId: thread.home.taskId,
      ...asked,
    };
    return this.apply(project, this.steps(project, sections, commands, targets), by);
  }

  /** The install and commands change, as a Proposal of them would carry it, when the call has one. */
  private commandsChange(project: Project, sections: Sections): ProposedCommands | undefined {
    const { install, installInputs, commands } = sections;
    if (install === undefined && installInputs === undefined && commands === undefined) {
      return undefined;
    }
    return proposedCommands(project, {
      installCommand: install,
      installInputs,
      commands: [...(commands?.add ?? []), ...(commands?.change ?? [])],
      removeCommands: commands?.remove,
    });
  }

  /** Each section's change, in the order they apply, Run environment last. */
  private steps(
    project: Project,
    sections: Sections,
    commands: ProposedCommands | undefined,
    targets: readonly EditedTestTarget[] | undefined,
  ): Step[] {
    const steps: Step[] = [];
    const { environmentVariables, testTargets, actions, runEnvironment } = sections;
    if (environmentVariables) {
      steps.push({
        setting: "Environment variables",
        run: async (by) => {
          const now = (await this.projects.read(project.id)).environment;
          await this.projects.changeEnvironment(
            project.id,
            {
              // Each Secret variable goes without its value, which keeps the Project's own.
              set: [
                ...now.set
                  .filter(({ secret }) => secret)
                  .map(({ name }) => ({ name, secret: true as const })),
                ...(environmentVariables.variables ?? now.set.filter(({ secret }) => !secret)).map(
                  ({ name, value }) => ({ name, value, secret: false as const }),
                ),
              ],
              unset: environmentVariables.unset ?? now.unset,
              prependPath: environmentVariables.prependPath ?? now.prependPath,
            },
            by,
          );
          return "Environment variables";
        },
      });
    }
    if (commands) {
      steps.push({
        setting: "commands",
        run: async (by) => {
          await this.projects.changeCommandsAsProposed(project.id, commands, by);
          return "commands";
        },
      });
    }
    if (testTargets && targets) {
      steps.push({
        setting: "test targets",
        run: async (by) => {
          const stored = await this.testTargets.list(project.id);
          await this.testTargets.change(
            project.id,
            editedList(stored.map(asEdited), targets, testTargets.removeTargets),
            null,
            by,
          );
          return "test targets";
        },
      });
    }
    if (actions) {
      steps.push({
        setting: "Actions",
        run: async (by) => {
          const now = await this.actions.list(project.id);
          const again = leavingTheWorkstation(now, actions.actions, actions.removeActions);
          if (again.length > 0) throw new ProjectRefused(again);
          await this.actions.change(
            project.id,
            editedList(now.map(withoutSetBy), actions.actions, actions.removeActions),
            null,
            by,
          );
          return "Actions";
        },
      });
    }
    if (runEnvironment) {
      steps.push({
        setting: "Run environment",
        run: async (by) => {
          await this.runEnvironments.change(project.id, runEnvironment, by);
          return `Run environment (${runEnvironment === "on" ? "On" : "Off"})`;
        },
      });
    }
    return steps;
  }

  /**
   * Applies each step in order; the first one refused stops the rest, and the answer names those
   * applied, each recorded on the Project, and why the next one was refused.
   */
  private async apply(
    project: Project,
    steps: readonly Step[],
    by: SettingChangedBy,
  ): Promise<OfficeToolResult> {
    const applied: string[] = [];
    for (const step of steps) {
      try {
        applied.push(await step.run(by));
      } catch (error) {
        if (!isRefusal(error) && applied.length === 0) throw error;
        let reason: string;
        if (isRefusal(error)) {
          reason = error.message;
        } else {
          // Answered rather than thrown, so the Agent learns what was already applied.
          this.logger.error(`Changing ${project.name}'s ${step.setting} failed.`, error);
          reason = "it failed unexpectedly, as The Office's log says.";
        }
        const left = steps.slice(steps.indexOf(step) + 1).map(({ setting }) => setting);
        const notTried = left.length > 0 ? ` Not changed after it: ${listed(left)}.` : "";
        if (applied.length === 0) return refusal(`${reason}${notTried}`);
        return refusal(
          `Changed ${project.name}'s ${listed(applied)}, each recorded in its Recent activity. Then the change of its ${step.setting} was refused: ${reason}${notTried}`,
        );
      }
    }
    return { text: `Changed: ${project.name}'s ${listed(applied)}.`, isError: false };
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
      if (isRefusal(error)) return refusal(error.message);
      throw error;
    }
  }
}

function refusal(text: string): OfficeToolResult {
  return { text, isError: true };
}

function isRefusal(error: unknown): error is Error {
  return (
    error instanceof ProjectRefused ||
    error instanceof ProposalRefused ||
    error instanceof ProjectNotFound
  );
}

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** The names of the variables given that are, or would be, Secret variables. */
function secretVariablesGiven(
  project: Project,
  given: Input["environmentVariables"],
): readonly string[] {
  const secrets = project.environment.set.filter(({ secret }) => secret);
  return (given?.variables ?? [])
    .filter(
      ({ name, secret }) => secret === true || secrets.some((each) => each.name === name.trim()),
    )
    .map(({ name }) => name.trim());
}

/** The call's sections that change something, the plain variables without their secret mark. */
function sectionsOf(given: Input): Sections {
  const { environmentVariables, install, installInputs, commands, testTargets, actions } = given;
  const variables = environmentVariables && {
    variables: environmentVariables.variables?.map(({ name, value }) => ({ name, value })),
    unset: environmentVariables.unset,
    prependPath: environmentVariables.prependPath,
  };
  return {
    ...(variables &&
    (variables.variables !== undefined ||
      variables.unset !== undefined ||
      variables.prependPath !== undefined)
      ? { environmentVariables: variables }
      : {}),
    ...(install !== undefined ? { install } : {}),
    ...(installInputs !== undefined ? { installInputs } : {}),
    ...(commands &&
    (commands.add?.length ?? 0) + (commands.change?.length ?? 0) + (commands.remove?.length ?? 0) >
      0
      ? { commands }
      : {}),
    ...(testTargets && testTargets.targets.length + testTargets.removeTargets.length > 0
      ? { testTargets }
      : {}),
    ...(actions && actions.actions.length + actions.removeActions.length > 0 ? { actions } : {}),
    ...(given.runEnvironment ? { runEnvironment: given.runEnvironment } : {}),
  };
}

/** The targets given, each Secret variable by name; each lacking its kind's field adds a problem. */
function editedTargets(given: TestTargetsInput, problems: string[]): EditedTestTarget[] {
  try {
    return proposedTargets(given.targets).map((target): EditedTestTarget => {
      if (target.kind === "install-on-a-device") return target;
      return { ...target, secretVariables: target.secretVariables.map((name) => ({ name })) };
    });
  } catch (error) {
    if (!(error instanceof ProposalRefused)) throw error;
    problems.push(error.message);
    return [];
  }
}

/** Every change of the call, one line per setting, as the approval card lists them: names only for secrets. */
function approvalLines(
  sections: Sections,
  project: Project,
  storedTargets: readonly TestTarget[],
  storedActions: readonly Action[],
): string[] {
  const lines: string[] = [];
  const { environmentVariables: variables, install, installInputs, commands } = sections;
  if (variables) {
    const parts = [
      ...(variables.variables
        ? [
            `plain variables become ${
              variables.variables.length > 0
                ? variables.variables.map(({ name, value }) => `${name}=${value}`).join(", ")
                : "none"
            }`,
          ]
        : []),
      ...(variables.unset
        ? [`inherited variables removed: ${variables.unset.join(", ") || "none"}`]
        : []),
      ...(variables.prependPath
        ? [`put in front of PATH: ${variables.prependPath.join(", ") || "none"}`]
        : []),
    ];
    lines.push(`Environment variables: ${parts.join("; ")}; the Secret variables stay as they are`);
  }
  if (install !== undefined) lines.push(`Install command: ${install.trim()}`);
  if (installInputs !== undefined) {
    lines.push(`Install inputs: ${installInputs.join(", ") || "none"}`);
  }
  if (commands) {
    const has = (key: string) => project.commands.some((command) => command.key === key.trim());
    lines.push(
      `Commands: ${[
        ...[...(commands.add ?? []), ...(commands.change ?? [])].map(
          ({ key, commandLine }) =>
            `${has(key) ? "changes" : "adds"} ${key.trim()} (${commandLine.trim()})`,
        ),
        ...(commands.remove ?? []).map((key) => `removes ${key.trim()}`),
      ].join("; ")}`,
    );
  }
  if (sections.testTargets) {
    const { targets, removeTargets } = sections.testTargets;
    lines.push(
      `Test targets: ${[
        ...targets.map((target) => {
          const key = target.key.trim();
          const verb = storedTargets.some((each) => each.key === key) ? "changes" : "adds";
          const secrets =
            target.secretVariables.length > 0
              ? `, Secret variables by name: ${target.secretVariables.join(", ")}`
              : "";
          return `${verb} ${key} (${KIND_WORDS[target.kind]}${secrets})`;
        }),
        ...removeTargets.map((key) => `removes ${key.trim()}`),
      ].join("; ")}`,
    );
  }
  if (sections.actions) {
    const { actions, removeActions } = sections.actions;
    lines.push(
      `Actions: ${[
        ...actions.map(({ key, name }) => {
          const verb = storedActions.some((each) => each.key === key.trim()) ? "changes" : "adds";
          return `${verb} ${key.trim()} (${name.trim()})`;
        }),
        ...removeActions.map((key) => `removes ${key.trim()} and its runs`),
      ].join("; ")}`,
    );
  }
  if (sections.runEnvironment) {
    lines.push(`Run environment: ${sections.runEnvironment === "on" ? "On" : "Off"}`);
  }
  return lines;
}

/** Each command added that the Project has, or changed or removed that it hasn't. */
function misplacedCommands(project: Project, commands: CommandsInput | undefined): string[] {
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
  if (target.kind === "install-on-a-device") return target;
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
