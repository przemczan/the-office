import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SignedInUser } from "../../../platform/http/signed-in-requests.js";
import { PullRequestMerged, type SettingChangedBy } from "../../projects/index.js";
import { TaskStateChanged, type OffBoardTaskStart } from "../../work/index.js";
import {
  DEFINITION_FILE,
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
 * What "Set up run environment" did: the run environment after it, and the start of its set-up
 * Task; undefined when a valid definition turned it On at once.
 */
export interface RunEnvironmentSetUp {
  readonly runEnvironment: ProjectRunEnvironment;
  readonly start: OffBoardTaskStart | undefined;
}

/**
 * A Project's Run environment setting and its set-up: On only with a valid definition on the base
 * branch, "Set up run environment" turning it On at once with one, else making and starting the Project's
 * "Set up the run environment" Task, whose Done turns it On with a valid definition on its branch.
 * Any other Task's Done, or its pull request's merge, turns a Not decided yet setting On once the
 * Task's own valid definition landed on the base branch.
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
      const setUp = await this.finishSetUp(taskId).catch((error: unknown) => {
        this.logger.error(`The Task ${taskId}'s run environment set-up wasn't read.`, error);
        return true;
      });
      if (!setUp) this.landInBackground(taskId, undefined);
    });
    this.events.subscribe(PullRequestMerged, ({ taskId, projectId }) => {
      this.landInBackground(taskId, projectId);
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
   * On is refused, with the reasons, unless the base branch, fetched now, has a valid definition.
   * Projects records the change as made `by`.
   */
  async change(
    projectId: string,
    runEnvironment: Exclude<RunEnvironmentSetting, "not-decided">,
    by: SettingChangedBy,
  ): Promise<ProjectRunEnvironment> {
    await this.settingOf(projectId);
    const problems =
      runEnvironment === "on" ? definitionProblemsOf(await this.freshDefinition(projectId)) : [];
    await this.settings.change(projectId, runEnvironment, problems, by);
    return this.read(projectId);
  }

  /**
   * On at once when the base branch, fetched now, has a valid definition; else the Project's open
   * set-up Task, or one made now as `by` asked and started at once, an Off-board Task.
   */
  async setUp(projectId: string, by: SignedInUser): Promise<RunEnvironmentSetUp> {
    await this.settingOf(projectId);
    if ((await this.freshDefinition(projectId)).state === "valid") {
      await this.settings.change(projectId, "on", [], {
        kind: "user",
        user: { userId: by.userId, name: by.name },
      });
      return { runEnvironment: await this.read(projectId), start: undefined };
    }
    const start = await this.setUpTasks.add(projectId, by);
    return { runEnvironment: await this.read(projectId), start };
  }

  /**
   * Whether the Task is a set-up Task, its Done read here.
   * Read from the Task's own branch: in Push + PR mode it is Done before its pull request merges,
   * so the base branch may not have the definition yet.
   */
  private async finishSetUp(taskId: string): Promise<boolean> {
    const task = await this.setUpTasks.setUpTaskOf(taskId);
    if (!task) return false;
    const tip = await this.files.taskBranchTip(task.projectId, task.id);
    const problems =
      tip === undefined
        ? [`The Task ${task.title} has no branch to read .devcontainer/ from.`]
        : definitionProblemsOf(await this.definitionAt(task.projectId, tip));
    await this.settings.finishSetUp(task.projectId, problems);
    return true;
  }

  /**
   * In the background, as it fetches and the bus waits for its handlers; caught there, the setting
   * staying as it was.
   */
  private landInBackground(taskId: string, projectId: string | undefined): void {
    void this.landDefinition(taskId, projectId).catch((error: unknown) => {
      this.logger.error(`The Task ${taskId}'s run environment definition wasn't read.`, error);
    });
  }

  /**
   * A Not decided yet setting turns On once the Task's change carrying a valid definition landed:
   * the Task's branch changed the definition since it forked from the base, its tip's is valid,
   * and the base branch, fetched now, has its files byte for byte. A push-only publish leaves the
   * base without them, so nothing changes; nor does a definition the Task only inherited, such as
   * one committed on the base by hand, an invalid one, or an explicit On or Off.
   */
  private async landDefinition(taskId: string, given: string | undefined): Promise<void> {
    const projectId = given ?? (await this.setUpTasks.projectOf(taskId));
    if (projectId === undefined) return;
    if ((await this.settings.settingOf(projectId))?.runEnvironment !== "not-decided") return;
    const tip = await this.files.taskBranchTip(projectId, taskId);
    if (tip === undefined) return;
    const atTip = await this.definitionFilesAt(projectId, tip);
    if (atTip === undefined) return;
    const base = await this.files.freshBase(projectId);
    if (!(await this.holds(projectId, base, atTip))) return;
    const forkPoint = await this.files.taskForkPoint(projectId, taskId, tip, base);
    if (await this.holds(projectId, forkPoint, atTip)) return;
    await this.settings.landDefinition(projectId);
  }

  /** Whether `commit` has each of `files` byte for byte. */
  private async holds(
    projectId: string,
    commit: string,
    files: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    for (const [path, text] of files) {
      if ((await this.files.textAt(projectId, commit, path)) !== text) return false;
    }
    return true;
  }

  /** The files a valid definition at `commit` is read from, by path; undefined when not valid. */
  private async definitionFilesAt(
    projectId: string,
    commit: string,
  ): Promise<ReadonlyMap<string, string> | undefined> {
    const texts = new Map<string, string>();
    const { reading } = await readDefinitionWith(async (path) => {
      const text = await this.files.textAt(projectId, commit, path);
      if (text !== undefined) texts.set(path, text);
      return text;
    });
    return reading.value === undefined || !texts.has(DEFINITION_FILE) ? undefined : texts;
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
