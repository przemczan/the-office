import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskStateChanged } from "../../work/index.js";
import {
  definitionProblemsOf,
  definitionStatusOf,
  type DefinitionStatus,
} from "../domain/run-environment-definition.js";
import { RunEnvironmentProjectNotFound } from "../domain/run-environment-setting-refused.js";
import {
  ProjectSettings,
  type ProjectSetting,
  type RunEnvironmentSetting,
} from "../ports/project-settings.js";
import { RepositoryFiles } from "../ports/repository-files.js";
import { SetUpTasks, type SetUpTask } from "../ports/set-up-tasks.js";
import { readDefinitionWith } from "./definition-files.js";

/** A Project's run environment as its page shows it. */
export interface ProjectRunEnvironment extends ProjectSetting {
  /** The definition on the base branch's last commit fetched. */
  readonly definition: DefinitionStatus;
  readonly setUpTask: SetUpTask | undefined;
}

/**
 * A Project's Run environment setting and its set-up: On only with a valid definition on the base
 * branch, "Set up run environment" turning it On at once with one, else adding the Project's
 * "Set up the run environment" Task, whose Done turns it On with a valid definition on its branch.
 */
@Injectable()
export class ProjectRunEnvironments implements OnModuleInit {
  private readonly logger = new Logger(ProjectRunEnvironments.name);

  constructor(
    private readonly settings: ProjectSettings,
    private readonly files: RepositoryFiles,
    private readonly setUpTasks: SetUpTasks,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to !== "done") return;
      // Caught here: the Task is Done either way, and the setting stays as it was.
      await this.finishSetUp(taskId).catch((error: unknown) => {
        this.logger.error(`The Task ${taskId}'s run environment set-up wasn't read.`, error);
      });
    });
  }

  /** The setting, the definition on the base branch's last commit fetched, and the open set-up Task. */
  async read(projectId: string): Promise<ProjectRunEnvironment> {
    const setting = await this.settingOf(projectId);
    const commit = await this.files.lastFetchedBase(projectId);
    return {
      ...setting,
      definition:
        commit === undefined ? { state: "not-found" } : await this.definitionAt(projectId, commit),
      setUpTask: await this.setUpTasks.openOf(projectId),
    };
  }

  /** On is refused, with the reasons, unless the base branch, fetched now, has a valid definition. */
  async change(
    projectId: string,
    runEnvironment: Exclude<RunEnvironmentSetting, "not-decided">,
  ): Promise<ProjectRunEnvironment> {
    await this.settingOf(projectId);
    const problems =
      runEnvironment === "on" ? definitionProblemsOf(await this.freshDefinition(projectId)) : [];
    await this.settings.change(projectId, runEnvironment, problems);
    return this.read(projectId);
  }

  /**
   * On at once when the base branch, fetched now, has a valid definition; else the Project's open
   * set-up Task, added when it has none.
   */
  async setUp(projectId: string): Promise<ProjectRunEnvironment> {
    await this.settingOf(projectId);
    if ((await this.freshDefinition(projectId)).state === "valid") {
      await this.settings.change(projectId, "on", []);
    } else {
      await this.setUpTasks.add(projectId);
    }
    return this.read(projectId);
  }

  /**
   * Read from the Task's own branch: in Push + PR mode it is Done before its pull request merges,
   * so the base branch may not have the definition yet.
   */
  private async finishSetUp(taskId: string): Promise<void> {
    const task = await this.setUpTasks.setUpTaskOf(taskId);
    if (!task) return;
    const tip = await this.files.taskBranchTip(task.projectId, task.id);
    const problems =
      tip === undefined
        ? [`The Task ${task.title} has no branch to read .devcontainer/ from.`]
        : definitionProblemsOf(await this.definitionAt(task.projectId, tip));
    await this.settings.finishSetUp(task.projectId, problems);
  }

  private async settingOf(projectId: string): Promise<ProjectSetting> {
    const setting = await this.settings.settingOf(projectId);
    if (!setting) throw new RunEnvironmentProjectNotFound(projectId);
    return setting;
  }

  private async freshDefinition(projectId: string): Promise<DefinitionStatus> {
    return this.definitionAt(projectId, await this.files.freshBase(projectId));
  }

  private async definitionAt(projectId: string, commit: string): Promise<DefinitionStatus> {
    return definitionStatusOf(
      await readDefinitionWith((path) => this.files.textAt(projectId, commit, path)),
    );
  }
}
