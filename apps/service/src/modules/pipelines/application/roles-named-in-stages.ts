import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PipelineRoleSources, type PipelineRolesNamed } from "../../people/index.js";
import { agentStageWorkers, NO_STAGE_WORKERS, type StageWorkers } from "../domain/stage.js";
import { rolesNamedByOpenTasks } from "../domain/task-stages.js";
import { RoleEngineCascade } from "../ports/role-engine-cascade.js";
import type { StageRolesNamed } from "../ports/stage-role-engines.js";
import { StartedTasks, type StartedTask } from "../ports/started-tasks.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { namedRoles, TaskStagesService } from "./task-stages-service.js";

/**
 * Tells People's capability check which Roles Agent Stages name (spec §5.4): the office-wide
 * Pipelines', run in any Project; and open Tasks' own Stages' and Project Pipelines' built Stages',
 * each run only in its Project. People merges the two sources. A Task under an engine override,
 * its own or its Initiative's, is left out of its Project's: it is weighed at its override alone
 * (spec §5.4.5), by whom its own Agent Stages name, which this also tells.
 */
@Injectable()
export class RolesNamedInStages implements OnModuleInit {
  constructor(
    private readonly library: PipelineLibrary,
    private readonly taskStages: TaskStagesRepository,
    private readonly tasks: StartedTasks,
    private readonly sources: PipelineRoleSources,
    private readonly stagesToWork: TaskStagesService,
    private readonly cascade: RoleEngineCascade,
  ) {}

  onModuleInit(): void {
    this.sources.register(() => this.rolesNamed());
    this.sources.register(() => this.rolesNamedByProjectPipelines());
    this.sources.registerTaskSource((taskId) => this.rolesNamedByTask(taskId));
  }

  /**
   * Whom the Stages the Task works name: its own, else its Pipeline's; none without a Pipeline, or
   * for a Task gone since People listed it.
   */
  async rolesNamedByTask(taskId: string): Promise<StageRolesNamed | undefined> {
    if ((await this.tasks.find(taskId)) === undefined) return undefined;
    const stages = await this.stagesToWork.stagesToWork(taskId);
    return stages === undefined ? undefined : namedRoles(agentStageWorkers(stages));
  }

  async rolesNamed(): Promise<PipelineRolesNamed> {
    const [everywhere, taskStages, tasks] = await Promise.all([
      this.library.rolesNamed(),
      this.taskStages.list(),
      this.tasks.open(),
    ]);
    const withOwnStages = new Set(taskStages.map(({ taskId }) => taskId));
    const onProjectLevels = await this.onProjectLevels(
      tasks.filter(({ id }) => withOwnStages.has(id)),
    );
    return rolesNamedOf(everywhere, rolesNamedByOpenTasks(taskStages, onProjectLevels));
  }

  /** The Tasks under no engine override, whose sessions run on their Project's levels. */
  private async onProjectLevels(tasks: readonly StartedTask[]): Promise<StartedTask[]> {
    const engines = await Promise.all(
      tasks.map(({ id, projectId }) => this.cascade.engineAt({ projectId, taskId: id })),
    );
    return tasks.filter((_, index) => {
      const level = engines[index]?.level;
      return level !== "task" && level !== "initiative";
    });
  }

  async rolesNamedByProjectPipelines(): Promise<PipelineRolesNamed> {
    return rolesNamedOf(NO_STAGE_WORKERS, await this.library.rolesNamedByProject());
  }
}

/** People's shape of who Stages name: Roles and duties apart, each where their sessions run. */
function rolesNamedOf(
  everywhere: StageWorkers,
  byProject: ReadonlyMap<string, StageWorkers>,
): PipelineRolesNamed {
  const projects = [...byProject];
  return {
    everywhere: everywhere.roles,
    byProject: new Map(projects.map(([projectId, { roles }]) => [projectId, roles])),
    duties: {
      everywhere: everywhere.duties,
      byProject: new Map(projects.map(([projectId, { duties }]) => [projectId, duties])),
    },
  };
}
