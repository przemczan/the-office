import { Injectable, type OnModuleInit } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import type { Effort } from "../../engine/index.js";
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

/** A Stage of a Task that sets its own effort, the model and effort cascade's most specific level. */
export interface StageOwnEffort {
  readonly stageName: string;
  readonly effort: Effort;
}

/**
 * A person who works on a Task, the engine their sessions about the Task run on with the model and
 * effort they work with there, and each of the Task's Stages they work that sets its own effort.
 */
export interface TaskRoleEngine {
  readonly roleKey: string;
  readonly roleName: string;
  /** None while no engine is listed. */
  readonly engine: EngineInCascade | null;
  readonly stages: readonly StageOwnEffort[];
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
      async ({ taskId, taskTitle, projectId, before, after, pipelineId }) => {
        const stages = await this.taskStages.stagesToWork(taskId);
        if (pipelineId === undefined) {
          if (stages === undefined) return [];
          const move: TaskStageRolesMove = {
            ...namedRoles(agentStageWorkers(stages)),
            projectId,
            before,
            after,
            taskTitle,
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
          taskTitle,
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
   * duty by its holder, with the Stages they work that set their own effort; a Role or duty nobody
   * fills is left out. Undefined for no such Task.
   */
  async of(taskId: string): Promise<readonly TaskRoleEngine[] | undefined> {
    const task = await this.tasks.find(taskId);
    if (task === undefined) return undefined;
    const working = await this.peopleWorking(taskId);
    const filled = await readEach([...working.keys()], async (roleKey) =>
      (await this.people.find(roleKey)) === undefined ? [] : [roleKey],
    );
    return readEach(filled.flat(), async (roleKey) => ({
      roleKey,
      roleName: this.people.roleTitle(roleKey),
      engine: await this.cascade.applying(roleKey, { projectId: task.projectId, taskId }),
      stages: working.get(roleKey) ?? [],
    }));
  }

  /** Each person working on the Task, in order, with the Stages they work that set an effort. */
  private async peopleWorking(taskId: string): Promise<Map<string, StageOwnEffort[]>> {
    const [planner, holders, stages] = await Promise.all([
      this.people.holderOf(PLANS),
      this.people.dutyHolders(),
      this.taskStages.stagesToWork(taskId),
    ]);
    const working = new Map<string, StageOwnEffort[]>();
    if (planner !== undefined) working.set(planner, []);
    for (const stage of stages ?? []) {
      const roleKey = workerOf(stage, holders);
      if (roleKey === undefined) continue;
      const own = working.get(roleKey) ?? [];
      working.set(roleKey, own);
      if (stage.kind === "agent" && stage.effort !== undefined) {
        own.push({ stageName: stage.name, effort: stage.effort });
      }
    }
    return working;
  }
}

/** Who works the Stage: its Role, or its duty's holder; none for a Stage no Agent works. */
function workerOf(stage: Stage, holders: ReadonlyMap<string, string>): string | undefined {
  const worker = stageWorker(stage);
  if (worker === undefined) return undefined;
  return "role" in worker ? worker.role : holders.get(worker.duty);
}
