import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { ActedBy, SettingChangedBy } from "../../projects/index.js";
import { TaskStateChanged, type OffBoardTaskStart } from "../../work/index.js";
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
import { KnownPeople } from "../ports/known-people.js";
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
 * What "Set up run environment" did: the run environment after it, and the start of its set-up
 * Task; undefined when a valid definition turned it On at once.
 */
export interface RunEnvironmentSetUp {
  readonly runEnvironment: ProjectRunEnvironment;
  readonly start: OffBoardTaskStart | undefined;
}

/**
 * A Project's Run environment setting and its set-up: On or Off at any time, nothing checked, as
 * each Task's checks read the definition on its own branch. "Set up run environment" turns it On at
 * once with a valid definition on the base branch, else makes and starts the Project's "Set up the
 * run environment" Task, whose Done turns it On with a valid definition on its branch.
 */
@Injectable()
export class ProjectRunEnvironments implements OnModuleInit {
  private readonly logger = new Logger(ProjectRunEnvironments.name);

  constructor(
    private readonly settings: ProjectSettings,
    private readonly files: RepositoryFiles,
    private readonly setUpTasks: SetUpTasks,
    private readonly events: EventBus,
    private readonly people: KnownPeople,
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

  /** Whether the Project's Run environment is On now; not for a Project there is none of. */
  async isOn(projectId: string): Promise<boolean> {
    return (await this.settings.settingOf(projectId))?.runEnvironment === "on";
  }

  /**
   * On or Off at any time, with no definition checked: each Task's checks read the one on its own
   * branch. Projects records the change as made `by`.
   */
  async change(
    projectId: string,
    runEnvironment: RunEnvironmentSetting,
    by: SettingChangedBy,
  ): Promise<ProjectRunEnvironment> {
    await this.settingOf(projectId);
    await this.settings.change(projectId, runEnvironment, by);
    return this.read(projectId);
  }

  /**
   * On at once when the base branch, fetched now, has a valid definition; else the Project's open
   * set-up Task, or one made now as `by` asked and started at once, an Off-board Task.
   */
  async setUp(projectId: string, by: ActedBy): Promise<RunEnvironmentSetUp> {
    await this.settingOf(projectId);
    if ((await this.freshDefinition(projectId)).state === "valid") {
      await this.settings.change(projectId, "on", await this.settingChangedBy(by));
      return { runEnvironment: await this.read(projectId), start: undefined };
    }
    const start = await this.setUpTasks.add(projectId, by);
    return { runEnvironment: await this.read(projectId), start };
  }

  /**
   * A set-up Task's Done, read here; any other Task's changes nothing.
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

  /** Who turned it On, the person by their name and title as they are now, so the record keeps them. */
  private async settingChangedBy(by: ActedBy): Promise<SettingChangedBy> {
    if (by.kind === "user")
      return { kind: "user", user: { userId: by.user.userId, name: by.user.name } };
    const card = (await this.people.find(by.roleKey))?.card;
    return {
      kind: "person",
      roleKey: by.roleKey,
      name: card?.name ?? by.roleKey,
      title: card?.title ?? by.roleKey,
      ...(by.taskId !== undefined && { taskId: by.taskId }),
      ...(by.askedBy && { askedBy: { userId: by.askedBy.userId, name: by.askedBy.name } }),
      ...(by.allowedBy && { allowedBy: { userId: by.allowedBy.userId, name: by.allowedBy.name } }),
    };
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
