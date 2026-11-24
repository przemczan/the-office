import { Injectable } from "@nestjs/common";
import {
  ACTION_TIME_LIMIT_MINUTES,
  type Action,
  type ProjectCommandActionSettings,
} from "../domain/action.js";
import { OutputMask } from "../domain/output-mask.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { isFeatureOn } from "../domain/project-features.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { Project } from "../domain/project.js";
import { ActionRepository } from "../ports/action-repository.js";
import { ProjectRepository } from "../ports/project-repository.js";
import type { ActionRunCommandLine } from "./action-run-checkouts.js";
import { runnableCommandsOf } from "./test-targets.js";
import { runEnvironmentInstallOf, type RunEnvironmentInstall } from "./task-run-environments.js";

/** What an Action run reads of its Project as it starts. */
export interface ActionRunProject {
  readonly id: string;
  readonly name: string;
  readonly baseBranch: string;
  /** Whether a Project command run runs in its own compose project, else on the workstation. */
  readonly runEnvironmentOn: boolean;
  /** The Project's Actions feature switch (spec §2.15, "The Actions feature switch"). */
  readonly actionsOn: boolean;
}

/** What a Project command Action's run runs with (spec §2.15, "Where a run runs"). */
export interface ProjectCommandRunSettings {
  readonly project: ActionRunProject;
  readonly action: Action & { readonly settings: ProjectCommandActionSettings };
  /**
   * The commands before it, then the command itself last, each by its name in the Project
   * (Install for `install`), with its command line; only those the Project still has set.
   */
  readonly commands: readonly ActionRunCommandLine[];
  /** The keys the Action names that the Project no longer has, or has blank; the run fails on them. */
  readonly missingCommands: readonly string[];
  /** Its own time limit, else the default 60 minutes; the commands before it included. */
  readonly timeoutMs: number;
  /**
   * The Project's environment and Secret variables, as a Task's checks get them; what The Office
   * sets is the caller's to add. Never The Office's own credentials.
   */
  readonly environment: ProjectEnvironment;
  /** Hides each of the Project's Secret variables as `[secret NAME]`. */
  readonly mask: OutputMask;
  /** What the Project's run environment image is made from, exactly as a Task's is. */
  readonly install: RunEnvironmentInstall;
}

/**
 * What the Actions module reads of a Project and its Actions to run one (spec §2.15): the Project's
 * name, base branch, Run environment and Actions switch, its Actions, and for a Project command
 * Action its commands resolved to command lines, the Project's environment and Secret variables
 * and their mask. A Workflow Action's start and its CI run are `ActionWorkflows`'.
 */
@Injectable()
export class ActionRunSettings {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly actions: ActionRepository,
  ) {}

  /** The Project as a run reads it. Throws ProjectNotFound for one that isn't there. */
  async projectOf(projectId: string): Promise<ActionRunProject> {
    return runProjectOf(await this.found(projectId));
  }

  /** The Project's Actions, in their order; answered while Actions are switched off too. */
  async actionsOf(projectId: string): Promise<readonly Action[]> {
    return this.actions.listOf(projectId);
  }

  /** The Action by its key; undefined when the Project has none of that key. */
  async actionOf(projectId: string, key: string): Promise<Action | undefined> {
    return (await this.actions.listOf(projectId)).find((action) => action.key === key);
  }

  /**
   * What the Project command Action `key` runs with. Refused (ProjectRefused) when the Project has
   * no Action of that key, or it is of another kind; a command it names that is gone is answered
   * in `missingCommands`, not refused, so the run fails naming it.
   */
  async commandRunOf(projectId: string, key: string): Promise<ProjectCommandRunSettings> {
    const project = await this.found(projectId);
    const action = (await this.actions.listOf(projectId)).find((each) => each.key === key);
    if (action === undefined) {
      throw new ProjectRefused([`${project.name} has no Action with the key "${key}".`]);
    }
    if (action.kind !== "project-command") {
      throw new ProjectRefused([`The Action ${action.name} doesn't run a Project command.`]);
    }
    const before = runnableCommandsOf(project);
    const own = before.filter(({ key: each }) =>
      project.commands.some((command) => command.key === each),
    );
    const resolved = [
      ...action.settings.commandsBefore.map((each) => ({
        key: each,
        found: before.find(({ key: k }) => k === each),
      })),
      {
        key: action.settings.commandKey,
        found: own.find(({ key: k }) => k === action.settings.commandKey),
      },
    ];
    const minutes = action.settings.timeLimitMinutes ?? ACTION_TIME_LIMIT_MINUTES.default;
    return {
      project: runProjectOf(project),
      action,
      commands: resolved.flatMap(({ found }) =>
        found === undefined || found.commandLine.trim() === ""
          ? []
          : [{ name: found.name, commandLine: found.commandLine }],
      ),
      missingCommands: resolved.flatMap(({ key: each, found }) =>
        found === undefined || found.commandLine.trim() === "" ? [each] : [],
      ),
      timeoutMs: minutes * 60_000,
      environment: project.environment,
      mask: OutputMask.of(project.environment),
      install: runEnvironmentInstallOf(project),
    };
  }

  private async found(projectId: string): Promise<Project> {
    const project = await this.projects.find(projectId);
    if (project === undefined) throw new ProjectNotFound(projectId);
    return project;
  }
}

function runProjectOf(project: Project): ActionRunProject {
  return {
    id: project.id,
    name: project.name,
    baseBranch: project.baseBranch,
    runEnvironmentOn: project.runEnvironment === "on",
    actionsOn: isFeatureOn(project, "actions"),
  };
}
