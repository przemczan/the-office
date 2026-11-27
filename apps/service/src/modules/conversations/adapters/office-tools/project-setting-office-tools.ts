import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { projectCommandSchema } from "@the-office/contracts";
import { z } from "zod";
import {
  OfficeToolRegistry,
  type OfficeToolCall,
  type OfficeToolChangedField,
  type OfficeToolDraft,
  type OfficeToolRedactedInput,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { RoleCards } from "../../../people/index.js";
import {
  ProjectActions,
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  RunEnvironmentSwitchRegistry,
  TestTargets,
  isFeatureOn,
  switchedOffWords,
  type Action,
  type ActionFields,
  type CommandEdit,
  type EditedTestTarget,
  type SettingChangedBy,
  type TestTarget,
} from "../../../projects/index.js";
import { latestWriter } from "../../domain/message.js";
import { ProposalRefused } from "../../domain/proposal-refused.js";
import { CHANGE_PROJECT_SETTINGS_TOOL } from "../../domain/session-instructions.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { actionInputWith } from "./action-office-tools.js";
import { proposedTargets, targetInput } from "./test-target-office-tools.js";

type Project = Awaited<ReturnType<ProjectService["read"]>>;

const SECRET_VALUES_GROUP = "secretValues";
const PUBLISHING_SETTINGS_GROUP = "publishingSettings";

const DESCRIPTION = `Changes a Project's everyday settings in one call: give everything a setup needs at once, in the sections it changes, each optional, at least one: environmentVariables, install, installInputs and commands, testTargets, actions, and runEnvironment. They apply in that order, Run environment last; each is changed as the Project page would, recorded in its Recent activity, and if one is refused, those before it stay applied and the answer names them. A Secret variable's value (an environment variable or a test target's) and an Action that leaves the workstation are ruled by their own rows of your Authority, besides this one, and the strictest of the rows the call touches rules it, so it may be held as a Proposal or for approval: a Secret value is shown by its name only on every card. The Publishing mode, Before and After publishing, Delete branches once merged and GitHub issues write-back, the Server values, the Engine, and the Default Pipeline and Project Pipelines have actions of their own.`;

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
            .array(
              z.object({
                name: z.string(),
                value: z
                  .string()
                  .optional()
                  .describe(
                    "The value to set; left out or empty, the value set now is kept. Giving one is ruled by Secret values.",
                  ),
              }),
            )
            .default([])
            .describe("The Secret variables it runs with, each by name, with a value to set."),
        }),
      )
      .default([])
      .describe("Targets to add, or to change by their key, each whole."),
    removeTargets: z.array(z.string()).default([]).describe("The keys of the targets to remove."),
  })
  .optional()
  .describe(
    "The Project's test targets, by the Project page's rules: targets to add or change by key, each given whole, and targets to remove; the others stay. A Secret variable's value already set is kept unless a value is given.",
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
              "Whether the Action pushes, publishes, deploys or releases, so leaves the workstation; give its value now when you change an Action. Adding one marked, changing or removing one marked, and setting or clearing the mark are ruled by Publishing settings. A Workflow is always marked.",
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
    "The Project's Actions, by the Project page's rules: Actions to add or change by key, each given whole, and Actions to remove; the others stay.",
  );

const environmentVariablesInput = z
  .object({
    variables: z
      .array(
        z.object({
          name: z.string(),
          value: z
            .string()
            .default("")
            .describe(
              "The value. For a Secret variable, the value to set: left out or empty, the value set now is kept.",
            ),
          secret: z
            .boolean()
            .optional()
            .describe(
              "True for a Secret variable; setting its value is ruled by Secret values, and every card shows its name only.",
            ),
        }),
      )
      .optional()
      .describe(
        "Every plain variable, whole: they replace the plain ones the Project has now. A Secret variable is given with secret true to set its value; the Secret variables not given stay as they are.",
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
    "The Project's Environment variables: the plain variables its commands and Agents run with, the Secret variables whose values are set, the inherited variables removed, and the folders put in front of PATH, each list given whole; a list left out stays.",
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
  why: z.string().describe("Why the settings should change, in a sentence or two."),
});

type Input = z.infer<typeof input>;
type CommandsInput = NonNullable<Input["commands"]>;
type TestTargetsInput = NonNullable<Input["testTargets"]>;
type ActionsInput = NonNullable<Input["actions"]>;
type EnvironmentSection = NonNullable<Input["environmentVariables"]>;

/**
 * What one call changes, each section left out when it changes nothing. A Secret variable's value
 * is in it, but never in the lines, fields or fingerprint made of it.
 */
interface Sections {
  readonly environmentVariables?: EnvironmentSection;
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
 * environment, in one call ruled by the person's Change Project settings Authority and, for what it
 * touches, by Publishing settings (an Action that leaves the workstation) and Secret values (a
 * Secret variable's value): the strictest of them rules the call (spec 5.4.1, "One ruling step").
 * Its check reads the Project and refuses all it can before the call is held, so an approval is
 * never spent on a call refused up front, and its approval lines list every change; then it applies
 * each section through the same method the Project page does, recorded as made by the session's
 * person, on its Task when the Thread has one, as asked by the user who wrote last and allowed by
 * the user whose Allow once let it run. Ruled Proposal, it is drafted as one Proposal of every
 * section, a Secret value by its name only, and applied as the user who applies it, recorded as that
 * Proposal applied.
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
    private readonly threads: ThreadRepository,
    private readonly roleCards: RoleCards,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: CHANGE_PROJECT_SETTINGS_TOOL,
      area: "projectsAndSettings",
      description: DESCRIPTION,
      input,
      authority: {
        group: "changeProjectSettings",
        title: "Change Project settings",
        subject: (given) => ({ kind: "project", id: (given as Input).project }),
        check: (given) =>
          this.onProject(
            (given as Input).project,
            async (found) => {
              const checked = await this.checked(found, given as Input);
              return "refused" in checked ? checked.refused : undefined;
            },
            (words) => words,
          ),
        approvalLines: (given) =>
          this.onProject(
            (given as Input).project,
            (found) => this.approvalLines(found, given as Input),
            () => [],
          ),
        groupsOf: (given) => this.groupsOf(given as Input),
      },
      run: (given, call) =>
        this.onProject(given.project, (found) => this.change(call, found, given), refusal),
      redact: (given) => Promise.resolve(redacted(given)),
      draft: (given) =>
        this.onProject(
          given.project,
          (found) => this.draftOf(found, given),
          (words) => {
            throw new ProposalRefused([words]);
          },
        ),
      applyFor: (given, { user, proposalId }) =>
        this.onProject(
          given.project,
          (found) =>
            this.applyAsUser(
              found,
              given,
              proposalId === undefined
                ? { kind: "user", user }
                : { kind: "proposal", proposalId, user },
            ),
          refusal,
        ),
    });
  }

  /**
   * The Authority groups besides Change Project settings the call touches: Publishing settings for an
   * Action that leaves the workstation it adds, changes or removes, or whose mark it sets or clears,
   * and Secret values for a Secret variable's value it gives.
   */
  private async groupsOf(given: Input): Promise<readonly string[]> {
    const groups: string[] = [];
    const sections = sectionsOf(given);
    if (sections.actions) {
      const project = await this.projects.find(given.project.trim());
      const stored = project ? await this.actions.list(project.id).catch(() => []) : [];
      if (touchesTheWorkstation(stored, sections.actions)) groups.push(PUBLISHING_SETTINGS_GROUP);
    }
    if (secretValuesGiven(sections).length > 0) groups.push(SECRET_VALUES_GROUP);
    return groups;
  }

  /** What the call changes, as a Proposal's card lists it, read now. */
  private async draftOf(project: Project, given: Input): Promise<OfficeToolDraft> {
    const checked = await this.checked(project, given);
    if ("refused" in checked) throw new ProposalRefused([checked.refused]);
    const { sections } = checked;
    const [storedTargets, storedActions] = await Promise.all([
      sections.testTargets ? this.testTargets.list(project.id) : [],
      sections.actions ? this.actions.list(project.id) : [],
    ]);
    return {
      subject: { kind: "project", id: project.id, title: project.name },
      fields: draftFields(sections, project, storedTargets, storedActions),
      fingerprint: fingerprintSource(sections, project, storedTargets, storedActions),
    };
  }

  private async change(
    { sessionId, allowedBy }: OfficeToolCall,
    project: Project,
    given: Input,
  ): Promise<OfficeToolResult> {
    // The ruling step checked the call already; checked again here, as the tool may run unruled.
    const checked = await this.checked(project, given);
    if ("refused" in checked) return refusal(checked.refused);
    const thread = await this.threads.findBySession(sessionId);
    if (!thread) return refusal("The Office doesn't know this session's Thread.");
    const person = await this.roleCards.find(thread.roleKey);
    const writer = latestWriter(await this.threads.messages(thread.id));
    const by: SettingChangedBy = {
      kind: "person",
      roleKey: thread.roleKey,
      name: person?.card.name ?? thread.roleKey,
      title: person?.card.title ?? thread.roleKey,
      ...(thread.home.kind === "task" ? { taskId: thread.home.taskId } : {}),
      ...(writer ? { askedBy: { userId: writer.userId, name: writer.name } } : {}),
      ...(allowedBy ? { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } } : {}),
    };
    return this.apply(project, this.steps(project, checked), by);
  }

  /** The call applied for the user who applied its Proposal, as the Project page would. */
  private async applyAsUser(
    project: Project,
    given: Input,
    by: SettingChangedBy,
  ): Promise<OfficeToolResult> {
    const checked = await this.checked(project, given);
    if ("refused" in checked) return refusal(checked.refused);
    return this.apply(project, this.steps(project, checked), by);
  }

  /**
   * The call's sections with the commands and test targets they change, or its refusal: every
   * refusal that doesn't need a section applied, so none is found after anyone was asked.
   */
  private async checked(project: Project, given: Input): Promise<Checked> {
    const sections = sectionsOf(given);
    if (Object.keys(sections).length === 0) {
      return {
        refused:
          "Nothing to change: give at least one of environmentVariables, install, installInputs, commands, testTargets, actions and runEnvironment.",
      };
    }
    const problems: string[] = [];
    for (const [section, feature] of [
      [sections.testTargets, "test-targets"],
      [sections.actions, "actions"],
    ] as const) {
      if (section && !isFeatureOn(project, feature)) {
        problems.push(switchedOffWords(feature, project.name));
      }
    }
    const commands = commandEditsOf(sections);
    if (commands)
      problems.push(...(await this.projects.commandEditsProblems(project.id, commands)));
    const targets = sections.testTargets && editedTargets(sections.testTargets, problems);
    problems.push(...secretNamesProblems(project, sections.environmentVariables));
    if (problems.length > 0) return { refused: problems.join(" ") };
    return { sections, commands, targets };
  }

  /** Every change of the call, one line per setting of the Project, as the approval card lists them. */
  private async approvalLines(project: Project, given: Input): Promise<readonly string[]> {
    const sections = sectionsOf(given);
    const [storedTargets, storedActions] = await Promise.all([
      sections.testTargets ? this.testTargets.list(project.id) : [],
      sections.actions ? this.actions.list(project.id) : [],
    ]);
    return changeLines(sections, project, storedTargets, storedActions).map(
      (line) => `${project.name}'s ${line}`,
    );
  }

  /** Each section's change, in the order they apply, Run environment last. */
  private steps(
    project: Project,
    { sections, commands, targets }: Extract<Checked, { sections: Sections }>,
  ): Step[] {
    const steps: Step[] = [];
    const { environmentVariables, testTargets, actions, runEnvironment } = sections;
    if (environmentVariables) {
      const secretsGiven = (environmentVariables.variables ?? [])
        .filter(({ secret }) => secret)
        .map(({ name, value }) => ({ name: name.trim(), value }));
      const plainGiven = (environmentVariables.variables ?? []).filter(({ secret }) => !secret);
      steps.push({
        setting: "Environment variables",
        run: async (by) => {
          const now = (await this.projects.read(project.id)).environment;
          await this.projects.changeEnvironment(
            project.id,
            {
              // A Secret variable not given keeps its value; one given without a value keeps it too.
              set: [
                ...now.set
                  .filter(
                    ({ secret, name }) =>
                      secret && !secretsGiven.some((each) => each.name === name),
                  )
                  .map(({ name }) => ({ name, secret: true as const })),
                ...secretsGiven.map(({ name, value }) => ({
                  name,
                  secret: true as const,
                  ...(value ? { value } : {}),
                })),
                ...(environmentVariables.variables
                  ? plainGiven
                  : now.set.filter(({ secret }) => !secret)
                ).map(({ name, value }) => ({ name, value, secret: false as const })),
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
          await this.projects.changeCommands(project.id, commands, by);
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
          const marked = actions.actions.map((action) =>
            markedAction(
              now.find(({ key }) => key === action.key.trim()),
              action,
            ),
          );
          await this.actions.change(
            project.id,
            editedList(now.map(withoutSetBy), marked, actions.removeActions),
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

  /** Runs `work` on the Project, answering a refusal of Projects as `refused` makes of its words. */
  private async onProject<Answer>(
    projectId: string,
    work: (project: Project) => Promise<Answer>,
    refused: (words: string) => Answer,
  ): Promise<Answer> {
    try {
      const project = await this.projects.find(projectId.trim());
      if (!project) return refused(`The Office has no Project "${projectId}".`);
      return await work(project);
    } catch (error) {
      // FeatureSwitchedOff is a ProjectRefused, so a switched-off Project is refused in its words.
      if (isRefusal(error)) return refused(error.message);
      throw error;
    }
  }
}

/** A call's sections as it may apply them, with what they change, or why it is refused. */
type Checked =
  | { readonly refused: string }
  | {
      readonly sections: Sections;
      readonly commands: readonly CommandEdit[] | undefined;
      readonly targets: readonly EditedTestTarget[] | undefined;
    };

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

/** Why a plain variable may not take a Secret variable's name: it would replace its value unseen. */
function secretNamesProblems(project: Project, given: Input["environmentVariables"]): string[] {
  const secrets = project.environment.set.filter(({ secret }) => secret);
  return (given?.variables ?? [])
    .filter(({ name, secret }) => !secret && secrets.some((each) => each.name === name.trim()))
    .map(
      ({ name }) =>
        `${name.trim()} is a Secret variable: give it with secret true, and a value to replace the one set now, or none to keep it.`,
    );
}

/** The names of the Secret values the sections give: a value, not the name alone. */
function secretValuesGiven(sections: Sections): string[] {
  return [
    ...(sections.environmentVariables?.variables ?? [])
      .filter(({ secret, value }) => secret && value !== "")
      .map(({ name }) => `${name.trim()} (Secret variable)`),
    ...(sections.testTargets?.targets ?? []).flatMap((target) =>
      target.secretVariables
        .filter(({ value }) => value !== undefined && value !== "")
        .map(({ name }) => `${name.trim()} (Secret variable of test target ${target.key.trim()})`),
    ),
  ];
}

/** The call's input as every card shows it: each Secret value emptied, its name kept. */
function redacted(given: Input): OfficeToolRedactedInput {
  const environment = given.environmentVariables;
  const targets = given.testTargets;
  const shown: Input = {
    ...given,
    ...(environment?.variables && {
      environmentVariables: {
        ...environment,
        variables: environment.variables.map((variable) =>
          variable.secret ? { ...variable, value: "" } : variable,
        ),
      },
    }),
    ...(targets && {
      testTargets: {
        ...targets,
        targets: targets.targets.map((target) => ({
          ...target,
          secretVariables: target.secretVariables.map(({ name }) => ({ name })),
        })),
      },
    }),
  };
  return {
    shown: shown as unknown as Record<string, unknown>,
    hasSecret: secretValuesGiven(sectionsOf(given)).length > 0,
  };
}

/**
 * Whether the Action change touches one that leaves the workstation: one added or changed marked so
 * or becoming a Workflow (always marked), one marked now changed, whose mark it clears, or removed.
 */
function touchesTheWorkstation(
  stored: readonly Action[],
  { actions, removeActions }: ActionsInput,
) {
  const given = actions.some((action) => {
    const before = stored.find(({ key }) => key === action.key.trim());
    return (
      before?.leavesTheWorkstation === true || markedAction(before, action).leavesTheWorkstation
    );
  });
  const removed = removeActions.some((key) =>
    stored.some((each) => each.key === key.trim() && each.leavesTheWorkstation),
  );
  return given || removed;
}

/**
 * The Action as the rules mark it (spec §2.15, "Leaves the workstation"): one added as a Workflow,
 * or changed to one from another kind, leaves the workstation whatever was given; any other keeps
 * the value given.
 */
function markedAction<Fields extends ActionFields>(
  before: Pick<ActionFields, "kind"> | undefined,
  after: Fields,
): Fields {
  return after.kind === "workflow" && before?.kind !== "workflow"
    ? { ...after, leavesTheWorkstation: true }
    : after;
}

/** The call's sections that change something. */
function sectionsOf(given: Input): Sections {
  const { environmentVariables, install, installInputs, commands, testTargets, actions } = given;
  const variables = environmentVariables && {
    variables: environmentVariables.variables,
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

/** The targets given, each Secret variable by name with the value given; each lacking its kind's field adds a problem. */
function editedTargets(given: TestTargetsInput, problems: string[]): EditedTestTarget[] {
  const secretsByTarget = new Map(
    given.targets.map((target) => [target.key, target.secretVariables]),
  );
  try {
    return proposedTargets(
      given.targets.map((target) => ({
        ...target,
        secretVariables: target.secretVariables.map(({ name }) => name),
      })),
    ).map((target): EditedTestTarget => {
      if (target.kind === "install-on-a-device") return target;
      const secrets = secretsByTarget.get(target.key) ?? [];
      return {
        ...target,
        secretVariables: target.secretVariables.map((name) => {
          const value = secrets.find((secret) => secret.name === name)?.value;
          return value ? { name, value } : { name };
        }),
      };
    });
  } catch (error) {
    if (!(error instanceof ProposalRefused)) throw error;
    problems.push(error.message);
    return [];
  }
}

/** Every change of the call, one line per setting: names only for secrets. */
function changeLines(
  sections: Sections,
  project: Project,
  storedTargets: readonly TestTarget[],
  storedActions: readonly Action[],
): string[] {
  const lines: string[] = [];
  const { environmentVariables: variables, install, installInputs, commands } = sections;
  if (variables) {
    const plain = (variables.variables ?? []).filter(({ secret }) => !secret);
    const secrets = (variables.variables ?? []).filter(({ secret, value }) => secret && value);
    const parts = [
      ...(variables.variables
        ? [
            `plain variables become ${
              plain.length > 0
                ? plain.map(({ name, value }) => `${name}=${value}`).join(", ")
                : "none"
            }`,
          ]
        : []),
      ...(secrets.length > 0
        ? [
            `Secret variables set, by name only: ${secrets.map(({ name }) => name.trim()).join(", ")}`,
          ]
        : []),
      ...(variables.unset
        ? [`inherited variables removed: ${variables.unset.join(", ") || "none"}`]
        : []),
      ...(variables.prependPath
        ? [`put in front of PATH: ${variables.prependPath.join(", ") || "none"}`]
        : []),
    ];
    lines.push(
      `Environment variables: ${parts.join("; ")}; the ${secrets.length > 0 ? "other " : ""}Secret variables stay as they are`,
    );
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
              ? `, Secret variables by name: ${target.secretVariables
                  .map(({ name, value }) => (value ? `${name} (value set)` : name))
                  .join(", ")}`
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
        ...actions.map((action) => {
          const key = action.key.trim();
          const before = storedActions.find((each) => each.key === key);
          const marked = markedAction(before, action).leavesTheWorkstation
            ? ", leaves the workstation"
            : "";
          return `${before ? "changes" : "adds"} ${key} (${action.name.trim()}${marked})`;
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

/**
 * The call's install, install inputs and commands as the edits the Project page's routes make, in
 * that order, added, then changed, then removed; none when the call has none. Their refusals are
 * the routes' own.
 */
function commandEditsOf({ install, installInputs, commands }: Sections): CommandEdit[] | undefined {
  if (install === undefined && installInputs === undefined && commands === undefined) {
    return undefined;
  }
  return [
    ...(install !== undefined ? [{ kind: "install", commandLine: install } as const] : []),
    ...(installInputs !== undefined
      ? [{ kind: "installInputs", inputs: installInputs } as const]
      : []),
    ...(commands?.add ?? []).map((command): CommandEdit => ({ kind: "add", command })),
    ...(commands?.change ?? []).map(({ key, ...fields }): CommandEdit => ({
      kind: "change",
      key: key.trim(),
      fields,
    })),
    ...(commands?.remove ?? []).map((key): CommandEdit => ({ kind: "remove", key: key.trim() })),
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

/** The one-line text of a list, "none" when empty. */
function listLines(items: readonly string[]): string {
  return items.length > 0 ? items.join("\n") : "none";
}

/** A field as a card lists it: a long text, or one of more than a line, is shown as a diff. */
function field(label: string, before: string | null, after: string | null): OfficeToolChangedField {
  const long = [before, after].some(
    (text) => text !== null && (text.includes("\n") || text.length > 80),
  );
  return { label, before, after, form: long ? "long" : "short" };
}

function targetWords(target: { key: string; kind: string }): string {
  const kind = KIND_WORDS[target.kind as keyof typeof KIND_WORDS] ?? target.kind;
  return `${target.key.trim()} (${kind})`;
}

function actionWords(action: { key: string; name: string; leavesTheWorkstation: boolean }): string {
  const leaves = action.leavesTheWorkstation ? ", leaves the workstation" : "";
  return `${action.key.trim()} (${action.name.trim()}${leaves})`;
}

/**
 * The fields a Proposal's card shows: one for each section given, what it is now and as it would
 * be, and a field of its own for each Secret value, by its name only, never its value.
 */
function draftFields(
  sections: Sections,
  project: Project,
  storedTargets: readonly TestTarget[],
  storedActions: readonly Action[],
): OfficeToolChangedField[] {
  const fields: OfficeToolChangedField[] = [];
  const { environmentVariables: variables, install, installInputs, commands } = sections;
  const now = project.environment;
  if (variables) {
    const plain = (variables.variables ?? []).filter(({ secret }) => !secret);
    const before = [
      ...(variables.variables ? now.set.filter(({ secret }) => !secret).map(shownVariable) : []),
      ...(variables.unset ? [`removed: ${now.unset.join(", ") || "none"}`] : []),
      ...(variables.prependPath
        ? [`in front of PATH: ${now.prependPath.join(", ") || "none"}`]
        : []),
    ];
    const after = [
      ...(variables.variables ? plain.map(({ name, value }) => `${name}=${value}`) : []),
      ...(variables.unset ? [`removed: ${variables.unset.join(", ") || "none"}`] : []),
      ...(variables.prependPath
        ? [`in front of PATH: ${variables.prependPath.join(", ") || "none"}`]
        : []),
    ];
    if (variables.variables || variables.unset || variables.prependPath) {
      fields.push(field("Environment variables", listLines(before), listLines(after)));
    }
  }
  if (install !== undefined) fields.push(field("Install", project.installCommand, install.trim()));
  if (installInputs !== undefined) {
    fields.push(
      field("Install inputs", listLines(project.installInputs), listLines(installInputs)),
    );
  }
  if (commands) {
    const given = [...(commands.add ?? []), ...(commands.change ?? [])];
    const touched = new Set([
      ...given.map(({ key }) => key.trim()),
      ...(commands.remove ?? []).map((key) => key.trim()),
    ]);
    fields.push(
      field(
        "Commands",
        listLines(
          project.commands
            .filter(({ key }) => touched.has(key))
            .map(({ key, commandLine }) => `${key}: ${commandLine}`),
        ),
        listLines([
          ...given.map(({ key, commandLine }) => `${key.trim()}: ${commandLine.trim()}`),
          ...(commands.remove ?? []).map((key) => `${key.trim()}: removed`),
        ]),
      ),
    );
  }
  if (sections.testTargets) {
    const { targets, removeTargets } = sections.testTargets;
    const touched = new Set([
      ...targets.map(({ key }) => key.trim()),
      ...removeTargets.map((key) => key.trim()),
    ]);
    fields.push(
      field(
        "Test targets",
        listLines(storedTargets.filter(({ key }) => touched.has(key)).map(targetWords)),
        listLines([
          ...targets.map(targetWords),
          ...removeTargets.map((key) => `${key.trim()}: removed`),
        ]),
      ),
    );
  }
  if (sections.actions) {
    const { actions, removeActions } = sections.actions;
    const touched = new Set([
      ...actions.map(({ key }) => key.trim()),
      ...removeActions.map((key) => key.trim()),
    ]);
    fields.push(
      field(
        "Actions",
        listLines(storedActions.filter(({ key }) => touched.has(key)).map(actionWords)),
        listLines([
          ...actions.map((action) =>
            actionWords({
              ...action,
              leavesTheWorkstation: markedAction(
                storedActions.find(({ key }) => key === action.key.trim()),
                action,
              ).leavesTheWorkstation,
            }),
          ),
          ...removeActions.map((key) => `${key.trim()}: removed`),
        ]),
      ),
    );
  }
  if (sections.runEnvironment) {
    fields.push(
      field(
        "Run environment",
        project.runEnvironment === "on" ? "On" : "Off",
        sections.runEnvironment === "on" ? "On" : "Off",
      ),
    );
  }
  for (const label of secretValuesGiven(sections)) {
    fields.push({ label, before: null, after: null, form: "secret" });
  }
  return fields;
}

function shownVariable(variable: { name: string; value?: string }): string {
  return `${variable.name}=${variable.value ?? ""}`;
}

/**
 * What the call reads and writes, as it stands now on the Project, for the Proposal's fingerprint:
 * each section given, without a Secret variable's value, so a change to any since the draft marks
 * the Proposal Out of date.
 */
function fingerprintSource(
  sections: Sections,
  project: Project,
  storedTargets: readonly TestTarget[],
  storedActions: readonly Action[],
): unknown {
  return {
    ...(sections.environmentVariables && {
      environment: {
        plain: project.environment.set.filter(({ secret }) => !secret).map(shownVariable),
        secrets: project.environment.set.filter(({ secret }) => secret).map(({ name }) => name),
        unset: project.environment.unset,
        prependPath: project.environment.prependPath,
      },
    }),
    ...((sections.install !== undefined || sections.installInputs !== undefined) && {
      install: [project.installCommand, project.installInputs],
    }),
    ...(sections.commands && { commands: project.commands }),
    ...(sections.testTargets && {
      testTargets: storedTargets.map(asEdited),
    }),
    ...(sections.actions && { actions: storedActions.map(withoutSetBy) }),
    ...(sections.runEnvironment && { runEnvironment: project.runEnvironment }),
  };
}
