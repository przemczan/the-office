import { Injectable, type OnModuleInit } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import type { DutyKey, EngineInCascade } from "../../people/index.js";
import { TaskEngineChecks, type TaskEngineChange } from "../../work/index.js";
import { agentStageWorkers, stageWorker, type Stage } from "../domain/stage.js";
import { KnownPeople } from "../ports/known-people.js";
import { RoleEngineCascade } from "../ports/role-engine-cascade.js";
import { StageRoleEngines, type TaskStageRolesMove } from "../ports/stage-role-engines.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { namedRoles, TaskStagesService } from "./task-stages-service.js";

/** The duty of whoever plans Tasks (People's `plans`), whose sessions run on a Task too. */
const PLANS: DutyKey = "plans";

/** A Role that works on a Task, and the engine its sessions about the Task run on. */
export interface TaskRoleEngine {
  readonly roleKey: string;
  readonly roleName: string;
  /** None while no engine is listed. */
  readonly engine: EngineInCascade | null;
}

/**
 * The engines a Task's Roles run on (spec §5.4.5): what the Task page's Engine block lists, and the
 * check Work runs before a change of Tasks' engines, as Work can't ask Pipelines about the Roles
 * its Stages name (the module template's registry).
 */
@Injectable()
export class TaskRoleEngines implements OnModuleInit {
  constructor(
    private readonly tasks: StartedTasks,
    private readonly taskStages: TaskStagesService,
    private readonly library: PipelineLibrary,
    private readonly people: KnownPeople,
    private readonly cascade: RoleEngineCascade,
    private readonly roleEngines: StageRoleEngines,
    private readonly engineChecks: TaskEngineChecks,
  ) {}

  onModuleInit(): void {
    this.engineChecks.register((change) => this.changeProblems(change));
  }

  /**
   * Each moved Task's sessions are weighed at its new levels by the Roles and duties its Agent
   * Stages name: its own Stages, else its Pipeline's; a Task with no Pipeline names none yet. A
   * move choosing its Pipeline weighs the chosen Pipeline's Stages, as built now for the Task's
   * Project, against those it works now; one neither has nor builds names none.
   */
  async changeProblems({ place, moves }: TaskEngineChange): Promise<readonly string[]> {
    const tasks = await readEach(
      moves,
      async ({ taskId, projectId, before, after, pipelineId }) => {
        const stages = await this.taskStages.stagesToWork(taskId);
        if (pipelineId === undefined) {
          if (stages === undefined) return [];
          const move: TaskStageRolesMove = {
            ...namedRoles(agentStageWorkers(stages)),
            projectId,
            before,
            after,
          };
          return [move];
        }
        const chosen = await this.library.forTask(pipelineId, projectId);
        if (chosen.kind !== "found") return [];
        const move: TaskStageRolesMove = {
          ...namedRoles(agentStageWorkers(chosen.pipeline.stages)),
          namedBefore: namedRoles(agentStageWorkers(stages ?? [])),
          projectId,
          before,
          after,
        };
        return [move];
      },
    );
    const named = tasks.flat();
    if (named.length === 0) return [];
    return this.roleEngines.workLevelsChangeProblems({ place, tasks: named });
  }

  /**
   * Whoever plans, then each Role the Task's Agent Stages name in the Stages' order, once each, a
   * duty by its holder; a Role or duty nobody fills is left out. Undefined for no such Task.
   */
  async of(taskId: string): Promise<readonly TaskRoleEngine[] | undefined> {
    const task = await this.tasks.find(taskId);
    if (task === undefined) return undefined;
    const roleKeys = await this.rolesWorking(taskId);
    const filled = await readEach(roleKeys, async (roleKey) =>
      (await this.people.find(roleKey)) === undefined ? [] : [roleKey],
    );
    return readEach(filled.flat(), async (roleKey) => ({
      roleKey,
      roleName: this.people.roleTitle(roleKey),
      engine: await this.cascade.applying(roleKey, { projectId: task.projectId, taskId }),
    }));
  }

  private async rolesWorking(taskId: string): Promise<string[]> {
    const [planner, holders, stages] = await Promise.all([
      this.people.holderOf(PLANS),
      this.people.dutyHolders(),
      this.taskStages.stagesToWork(taskId),
    ]);
    const named = (stages ?? []).flatMap((stage: Stage) => {
      const worker = stageWorker(stage);
      if (worker === undefined) return [];
      if ("role" in worker) return [worker.role];
      const holder = holders.get(worker.duty);
      return holder === undefined ? [] : [holder];
    });
    return [...new Set([...(planner === undefined ? [] : [planner]), ...named])];
  }
}
