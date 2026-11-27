import { isAbsolute, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SignedInUser } from "../../../platform/http/signed-in-requests.js";
import { EngineReferenceLock } from "../../engine/index.js";
import {
  projectIdFor,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectCommand,
  type ProjectCommandFields,
  type ProjectEngine,
  type ProjectMark,
  type PublishingLine,
  type PublishingMode,
  type RunEnvironmentAnswer,
  type RunEnvironmentSetting,
} from "../domain/project.js";
import {
  addProject,
  asProjectChanges,
  changeCommandsBy,
  commandEditsProblems,
  removedKeysOf,
  type CommandEdit,
  changeInstallCommand,
  changeDefaultPipeline,
  changeIssueSettings,
  changeKindDefaultPipeline,
  changeEnvironment,
  changeInstallInputs,
  changeMark,
  changeProjectEngine,
  changeProjectLimit,
  changePublishingLine,
  changePublishingMode,
  changeDeleteMergedBranches,
  changeRunEnvironment,
  changeProjectSkillUse,
  changeUseProjectSkills,
  finishRunEnvironmentSetUp,
  type ProjectChange,
  type ProjectChanges,
} from "../domain/project-changes.js";
import { byTheUser } from "../domain/acted-by.js";
import { defaultPipelineFor, type TaskKind } from "../domain/kind-default-pipeline.js";
import type { IssueSettingsChange, IssueUser } from "../domain/issue-settings.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { sameDefault, sameStandIns, type ProjectEngineChange } from "../domain/project-engine.js";
import { OutputMask } from "../domain/output-mask.js";
import {
  editedEnvironment,
  trimmedEnvironment,
  type ProjectEnvironmentEdit,
} from "../domain/project-environment.js";
import {
  proposedCommandsProblems,
  removedCommandKeys,
  type ProposedCommands,
} from "../domain/proposed-commands.js";
import { reservedEnvironmentProblems } from "../domain/action.js";
import type {
  ProjectSetting,
  SettingChangedBy,
  SettingChangeToRecord,
} from "../domain/project-setting-change.js";
import {
  COMMANDS_CHANGED,
  INSTALL_CHANGED,
  INSTALL_INPUTS_CHANGED,
  commandAddedSummary,
  commandChangedSummary,
  commandRemovedSummary,
  environmentSummary,
  runEnvironmentSummary,
  type SettingChangeRecording,
} from "../domain/setting-change-summaries.js";
import { ActionRepository } from "../ports/action-repository.js";
import { CLONE_REMOTE, Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { EngineLevelsChecks } from "./engine-levels-checks.js";
import { FirstCommits } from "./first-commits.js";
import { ProjectChecks } from "./project-checks.js";
import { ensureFeatureOn } from "./project-features.js";
import { RunEnvironmentSetUpRegistry } from "./run-environment-set-up-registry.js";

/**
 * The Projects use cases. Each change is saved first and its event published after, so nothing
 * hears of a change that wasn't kept.
 */
/** The user's answer to the run environment question as they added a Project. */
export interface RunEnvironmentAnswered {
  readonly answer: RunEnvironmentAnswer;
  readonly by: SignedInUser;
}

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly repository: ProjectRepository,
    private readonly checks: ProjectChecks,
    private readonly git: Git,
    private readonly events: EventBus,
    private readonly engineLevelsChecks: EngineLevelsChecks,
    private readonly engineReferences: EngineReferenceLock,
    private readonly runEnvironmentSetUp: RunEnvironmentSetUpRegistry,
    private readonly actions: ActionRepository,
    private readonly firstCommits: FirstCommits,
  ) {}

  /**
   * Refuses with every reason, before saving, when the Project breaks a rule. Every Project is added
   * with its Run environment Off; the answer to the run environment question, when given, is
   * applied once it is added, and one added with none, such as a Proposal's, stays Off.
   */
  async add(given: NewProject, answered?: RunEnvironmentAnswered): Promise<Project> {
    const newProject = withResolvedPath(trimmedNewProject(given));
    await this.checks.checkNewProject(newProject);
    // Before it is saved, so a first commit that couldn't be pushed adds nothing.
    await this.firstCommits.makeWhenEmpty(newProject);
    await this.trackBaseBranchOfClone(newProject);
    const takenIds = new Set((await this.repository.list()).map((project) => project.id));
    const { project, event } = addProject(
      projectIdFor(newProject.name, takenIds),
      newProject,
      new Date(),
    );
    await this.repository.add(project);
    await this.events.publish(event);
    return answered ? this.answerRunEnvironment(project, answered) : project;
  }

  /**
   * The Project is added Off either way: "no" leaves it so, and "yes" runs Set up run environment;
   * a set-up that fails is logged and leaves it Off.
   */
  private async answerRunEnvironment(
    project: Project,
    { answer, by }: RunEnvironmentAnswered,
  ): Promise<Project> {
    if (answer !== "yes") return project;
    try {
      await this.runEnvironmentSetUp.setUp(project.id, byTheUser(by));
      return await this.read(project.id);
    } catch (error) {
      this.logger.error(
        `The Project ${project.name}'s run environment answer wasn't applied.`,
        error,
      );
    }
    return project;
  }

  /**
   * A clone has only its default branch locally; another base branch is made from the remote's,
   * tracking it, so worktrees start from its upstream as from any base branch (spec §5.5 Defaults).
   */
  private async trackBaseBranchOfClone({
    path,
    baseBranch,
    repositoryUrl,
  }: NewProject): Promise<void> {
    if (repositoryUrl === undefined || (await this.git.hasBranch(path, baseBranch))) return;
    await this.git.trackRemoteBranch(path, { remote: CLONE_REMOTE, branch: baseBranch });
  }

  /** Every reason `add` would refuse the Project now, as a Proposal of it is judged. */
  async newProjectProblems(given: NewProject): Promise<string[]> {
    return this.checks.newProjectProblems(withResolvedPath(trimmedNewProject(given)));
  }

  async list(): Promise<readonly Project[]> {
    return this.repository.list();
  }

  async read(id: string): Promise<Project> {
    const project = await this.find(id);
    if (!project) throw new ProjectNotFound(id);
    return project;
  }

  /** The Projects of these ids that The Office knows, with their names now, for Stats. */
  async namesOf(
    ids: readonly string[],
  ): Promise<readonly { readonly projectId: string; readonly name: string }[]> {
    const wanted = new Set(ids);
    return (await this.repository.list())
      .filter(({ id }) => wanted.has(id))
      .map(({ id, name }) => ({ projectId: id, name }));
  }

  /** Undefined when there is no such Project. */
  async find(id: string): Promise<Project | undefined> {
    return this.repository.find(id);
  }

  /**
   * The Pipeline a new Task of `kind` gets in the Project (`defaultPipelineFor`); undefined when
   * there is no such Project.
   */
  async defaultPipelineFor(projectId: string, kind: TaskKind): Promise<string | undefined> {
    const project = await this.find(projectId);
    return project && defaultPipelineFor(project, kind);
  }

  /** The Project added from the repository at `path`, read as `add` reads it; undefined when none. */
  async findByPath(path: string): Promise<Project | undefined> {
    const repositoryPath = resolvedPath(path.trim());
    return (await this.repository.list()).find((project) => project.path === repositoryPath);
  }

  /** A worktree installs again before its next Stage, as its last install ran another line. */
  async changeInstallCommand(
    id: string,
    commandLine: string,
    by: SettingChangedBy,
  ): Promise<Project> {
    return this.update(
      id,
      (project) => changeInstallCommand(project, commandLine),
      recorded("commands", INSTALL_CHANGED, by),
    );
  }

  async addCommand(id: string, command: ProjectCommand, by: SettingChangedBy): Promise<Project> {
    return this.changeCommands(id, [{ kind: "add", command }], by);
  }

  /** A running Task runs the new line from its next Script Stage, which reads it when it runs. */
  async changeCommand(
    id: string,
    key: string,
    change: ProjectCommandFields,
    by: SettingChangedBy,
  ): Promise<Project> {
    return this.changeCommands(id, [{ kind: "change", key, fields: change }], by);
  }

  /** Refused while the Project's default Pipeline, or a Kind's, runs the command (spec §2.1). */
  async removeCommand(id: string, key: string, by: SettingChangedBy): Promise<Project> {
    return this.changeCommands(id, [{ kind: "remove", key }], by);
  }

  async changeInstallInputs(
    id: string,
    installInputs: readonly string[],
    by: SettingChangedBy,
  ): Promise<Project> {
    return this.update(
      id,
      (project) => changeInstallInputs(project, installInputs),
      recorded("commands", INSTALL_INPUTS_CHANGED, by),
    );
  }

  /**
   * Every reason a Proposal of commands can't apply to the Project now
   * (`proposedCommandsProblems`), or that there is no such Project.
   */
  async proposedCommandsProblems(id: string, proposed: ProposedCommands): Promise<string[]> {
    const project = await this.find(id);
    if (!project) return [new ProjectNotFound(id).message];
    return [
      ...proposedCommandsProblems(project, proposed),
      ...(await this.checks.commandRemovalProblems(project, removedCommandKeys(proposed))),
    ];
  }

  /**
   * Every reason the edits can't apply to the Project now, as `changeCommands` refuses them
   * (`commandEditsProblems`, and a command a default Pipeline runs can't be removed), or that
   * there is no such Project.
   */
  async commandEditsProblems(id: string, edits: readonly CommandEdit[]): Promise<string[]> {
    const project = await this.find(id);
    if (!project) return [new ProjectNotFound(id).message];
    return [
      ...(await this.checks.commandRemovalProblems(project, removedKeysOf(edits))),
      ...commandEditsProblems(project, edits),
    ];
  }

  /**
   * Applies the edits all or nothing, as the one way commands change (the Project page's routes
   * with one edit each, the Agents' tool, an applied Proposal): checked against the Project as its
   * row is held and saved in one go, so a hand edit can't land between edits, and one edit that
   * breaks a rule saves none. Refused while the default Pipeline, or a Kind's, runs a command it
   * removes (spec §2.1).
   */
  async changeCommands(
    id: string,
    edits: readonly CommandEdit[],
    by: SettingChangedBy,
  ): Promise<Project> {
    const removalProblems = await this.checks.commandRemovalProblems(
      await this.read(id),
      removedKeysOf(edits),
    );
    if (removalProblems.length > 0) throw new ProjectRefused(removalProblems);
    return this.updateTogether(
      id,
      (project) => changeCommandsBy(project, edits),
      recorded("commands", commandEditsSummary(edits), by),
    );
  }

  /**
   * Hides the Project's Secret variables in what its sessions write (spec §6), as it reads now; a
   * Project gone hides nothing, as nothing of it runs any more.
   */
  async outputMaskOf(id: string): Promise<OutputMask> {
    const project = await this.find(id);
    return project ? OutputMask.of(project.environment) : OutputMask.NONE;
  }

  /**
   * The user's Save of the environment (spec §5.5): a Secret variable given without a value keeps
   * the Project's. Refuses with every reason, saving nothing, when it breaks a rule, a variable
   * named as one The Office sets in an Action's run among them while the Project has a Project
   * command Action (spec §2.15, "What The Office sets").
   */
  async changeEnvironment(
    id: string,
    edit: ProjectEnvironmentEdit,
    by: SettingChangedBy,
  ): Promise<Project> {
    const actions = await this.actions.listOf(id);
    return this.update(
      id,
      (project) => {
        const environment = trimmedEnvironment(editedEnvironment(edit, project.environment));
        const problems = [
          ...this.checks.environmentProblems(environment),
          ...reservedEnvironmentProblems(environment.set, actions),
        ];
        if (problems.length > 0) throw new ProjectRefused(problems);
        return changeEnvironment(project, environment);
      },
      (before, after) => ({
        setting: "environment",
        summary: environmentSummary(before.environment, after.environment),
        by,
      }),
    );
  }

  /** Publish's before or after line (spec §2.3 Defaults); blank clears it. */
  async changePublishingLine(
    id: string,
    line: PublishingLine,
    commandLine: string,
  ): Promise<Project> {
    return this.update(id, (project) => changePublishingLine(project, line, commandLine));
  }

  async changeDeleteMergedBranches(id: string, on: boolean): Promise<Project> {
    return this.update(id, (project) => changeDeleteMergedBranches(project, on));
  }

  async changePublishingMode(id: string, publishingMode: PublishingMode): Promise<Project> {
    return this.update(id, (project) => changePublishingMode(project, publishingMode));
  }

  /** The user's On or Off, either way at any time, with nothing checked. */
  async changeRunEnvironment(
    id: string,
    runEnvironment: RunEnvironmentSetting,
    by: SettingChangedBy,
  ): Promise<Project> {
    return this.update(
      id,
      (project) => changeRunEnvironment(project, runEnvironment),
      recorded("run-environment", runEnvironmentSummary(runEnvironment), by),
    );
  }

  /**
   * A set-up Task is Done, with these problems of the definition on its branch; recorded as no
   * setting change, as nobody turned the switch.
   */
  async finishRunEnvironmentSetUp(
    id: string,
    definitionProblems: readonly string[],
  ): Promise<Project> {
    return this.update(id, (project) => finishRunEnvironmentSetUp(project, definitionProblems));
  }

  /** Lowering it stops no started Task: nothing new starts in the Project until enough end. */
  async changeProjectLimit(id: string, projectLimit: number): Promise<Project> {
    return this.update(id, (project) => changeProjectLimit(project, projectLimit));
  }

  async changeMark(id: string, mark: ProjectMark): Promise<Project> {
    return this.update(id, (project) => changeMark(project, mark));
  }

  /** Refused for a Pipeline running a command the Project lacks (spec §2.3). */
  async changeDefaultPipeline(id: string, defaultPipeline: string): Promise<Project> {
    await this.checks.checkDefaultPipeline({ ...(await this.read(id)), defaultPipeline });
    return this.update(id, (project) => changeDefaultPipeline(project, defaultPipeline));
  }

  /**
   * A Kind's own default Pipeline; null follows the Project's default Pipeline. Refused, as the
   * Project's default is, for a Pipeline running a command the Project lacks.
   */
  async changeKindDefaultPipeline(
    id: string,
    kind: TaskKind,
    pipelineId: string | null,
  ): Promise<Project> {
    if (pipelineId !== null) {
      await this.checks.checkDefaultPipeline({
        ...(await this.read(id)),
        defaultPipeline: pipelineId,
      });
    }
    return this.update(id, (project) => changeKindDefaultPipeline(project, kind, pipelineId));
  }

  /**
   * The Project's GitHub issue switches; a label set records `by` as who set it. Refused
   * (`FeatureSwitchedOff`) while its GitHub issues are switched off.
   */
  async changeIssueSettings(
    id: string,
    settings: IssueSettingsChange,
    by: IssueUser,
  ): Promise<Project> {
    return this.update(id, (project) => {
      ensureFeatureOn(project, "github-issues");
      return changeIssueSettings(project, settings, by);
    });
  }

  /** The Project's levels of both cascades; throws ProjectNotFound when there is none. */
  async engineLevelsOf(id: string): Promise<ProjectEngine> {
    return (await this.read(id)).engine;
  }

  /** Every Project's levels of both cascades, with its id and name, in the list's order. */
  async engineLevelsOfEveryProject(): Promise<
    readonly (ProjectEngine & { readonly projectId: string; readonly projectName: string })[]
  > {
    return (await this.repository.list()).map((project) => ({
      projectId: project.id,
      projectName: project.name,
      ...project.engine,
    }));
  }

  /**
   * Saves the Project page's Engine block, each level sent replacing the Project's (spec §5.4.5,
   * "The API"); sessions already running keep what they started with. Refused, before saving, for
   * an engine Settings › Engines doesn't list or a model or effort a type doesn't offer, and, when
   * the default or the Stand-in Engine list changes, for what a registered check refuses. Held under Engine's
   * `EngineReferenceLock` from reading the engines through the save, so a removal can't come in
   * between; the event is published after. The check weighs the Project as read just before, so
   * another change to it made in between goes unchecked.
   */
  async changeEngine(id: string, change: ProjectEngineChange): Promise<Project> {
    const { project, events } = await this.engineReferences.holding(async () => {
      const offers = await this.checks.engineTypeOffers();
      const stored = await this.read(id);
      const changed = changeProjectEngine(stored, change, offers)?.project;
      if (changed) {
        await this.checks.checkProjectEngine(changed.engine, stored.engine);
        if (
          !sameDefault(stored.engine.default, changed.engine.default) ||
          !sameStandIns(stored.engine.standIns, changed.engine.standIns)
        ) {
          const problems = await this.engineLevelsChecks.problemsOf({
            projectId: id,
            projectName: stored.name,
            before: stored.engine,
            after: changed.engine,
          });
          if (problems.length > 0) throw new ProjectRefused(problems);
        }
      }
      return this.repository.update(id, (current) =>
        asProjectChanges(current, changeProjectEngine(current, change, offers)),
      );
    });
    await this.publish(events);
    return project;
  }

  /** Sessions already running keep the skills they started with. */
  async changeUseProjectSkills(id: string, useProjectSkills: boolean): Promise<Project> {
    return this.update(id, (project) => changeUseProjectSkills(project, useProjectSkills));
  }

  /** Sessions already running keep the skills they started with. */
  async changeProjectSkillUse(id: string, key: string, use: boolean): Promise<Project> {
    return this.update(id, (project) => changeProjectSkillUse(project, key, use));
  }

  private async update(
    id: string,
    change: (project: Project) => ProjectChange<DomainEvent> | undefined,
    record?: SettingChangeRecording<Project>,
  ): Promise<Project> {
    return this.updateTogether(id, (project) => asProjectChanges(project, change(project)), record);
  }

  /** `record`, when given, is kept with the change, and only when the change saves something. */
  private async updateTogether(
    id: string,
    change: (project: Project) => ProjectChanges,
    record?: SettingChangeRecording<Project>,
  ): Promise<Project> {
    const { project, events } = await this.repository.update(id, change, record);
    await this.publish(events);
    return project;
  }

  private async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) await this.events.publish(event);
  }
}

function recorded(
  setting: ProjectSetting,
  summary: string,
  by: SettingChangedBy,
): SettingChangeToRecord {
  return { setting, summary, by };
}

/** One edit is recorded in its own words, as the Project page names it; more, as a change of commands. */
function commandEditsSummary(edits: readonly CommandEdit[]): string {
  const [only] = edits;
  if (edits.length !== 1 || !only) return COMMANDS_CHANGED;
  switch (only.kind) {
    case "add":
      return commandAddedSummary(only.command.key);
    case "change":
      return commandChangedSummary(only.key);
    case "remove":
      return commandRemovedSummary(only.key);
    case "install":
      return INSTALL_CHANGED;
    case "installInputs":
      return INSTALL_INPUTS_CHANGED;
    case "publishingLine":
      return COMMANDS_CHANGED;
  }
}

function withResolvedPath(newProject: NewProject): NewProject {
  return { ...newProject, path: resolvedPath(newProject.path) };
}

/** The path as the repository's folder is named: without `..` or a trailing separator. */
function resolvedPath(path: string): string {
  return isAbsolute(path) ? resolve(path) : path;
}
