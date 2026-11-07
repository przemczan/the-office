import { walkedStages, withoutResolveStages } from "../domain/resolve-stages.js";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { TaskPipelineConfirmed } from "../../work/index.js";
import type { Pipeline, StageProblem } from "../domain/pipeline.js";
import { agentStageRoles, newlyNamedRoles, type Stage } from "../domain/stage.js";
import { reportedMet } from "../domain/pipeline-walk.js";
import { stagesProgress, type TaskProgress } from "../domain/stage-progress.js";
import type { StageRun } from "../domain/stage-run.js";
import { staffingProblems } from "../domain/stage-staffing.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import {
  editProblems,
  editTaskStages,
  firstStageToWork,
  followsPipeline,
  lockedStageCount,
  makeTaskStages,
  whyStagesAreKept,
  type TaskStages,
  type TaskTrace,
} from "../domain/task-stages.js";
import { TaskStagesReset } from "../domain/task-stages-events.js";
import { StageRoleEngines } from "../ports/stage-role-engines.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { RoleFillings } from "./role-fillings.js";

/**
 * Each Task's own Stages: copied from its library Pipeline as the Task starts, or as the user first
 * edits them for the Task, so saving the library later reaches only Tasks that follow it (spec
 * §2.3). Changes to a Task's Stages, and the walk's start of each run, go one at a time per Task,
 * so no Stage starts under a definition an edit has just replaced.
 */
@Injectable()
export class TaskStagesService implements OnModuleInit {
  private readonly changes = new KeyedLocks();

  constructor(
    private readonly repository: TaskStagesRepository,
    private readonly runs: StageRunRepository,
    private readonly library: PipelineLibrary,
    private readonly tasks: StartedTasks,
    private readonly roleFillings: RoleFillings,
    private readonly roleEngines: StageRoleEngines,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskPipelineConfirmed, ({ taskId, pipelineId }) =>
      this.reset(taskId, pipelineId),
    );
  }

  /**
   * The Task's own Stages as it starts: those it has for its Pipeline, or a copy of the Pipeline's.
   * Work refuses Start for a Pipeline the library doesn't have, so a missing one is a fault.
   */
  async make(taskId: string, pipelineId: string): Promise<TaskStages> {
    return this.changes.run(taskId, async () => {
      const existing = await this.repository.find(taskId);
      if (existing && followsPipeline(existing, pipelineId)) return existing;
      const pipeline = await this.pipeline(taskId, pipelineId);
      const { taskStages, event } = makeTaskStages(taskId, pipeline, new Date());
      await this.repository.save(taskStages);
      await this.events.publish(event);
      return taskStages;
    });
  }

  /** The Task's own Stages, when it has them for the Pipeline it has now. */
  async find(taskId: string): Promise<TaskStages | undefined> {
    const own = await this.repository.find(taskId);
    if (!own) return undefined;
    return followsPipeline(own, (await this.tasks.read(taskId)).pipelineId) ? own : undefined;
  }

  /** Where each of the Task's own Stages stands; undefined while the Task follows its Pipeline. */
  async progress(taskId: string): Promise<TaskProgress | undefined> {
    const own = await this.find(taskId);
    return own && progressOf(own, await this.runs.list(taskId));
  }

  /** What each command of the Task's run printed, in its order; undefined for no such run. */
  commandOutputs(taskId: string, runId: string): Promise<readonly string[] | undefined> {
    return this.runs.commandOutputs(taskId, runId);
  }

  /**
   * The user's edit of the Task's Stages for that Task, which leaves the library Pipeline as it is;
   * refused with every reason the edited Stages can't run, or change a Stage that has started.
   */
  async edit(taskId: string, edited: readonly Stage[]): Promise<TaskProgress> {
    return this.changes.run(taskId, async () => {
      const { own, runs, problems } = await this.review(taskId, edited);
      if (problems.length > 0) throw new StagesEditRefused(problems);
      const { taskStages, event } = editTaskStages(own, withoutResolveStages(edited));
      await this.repository.save(taskStages);
      await this.events.publish(event);
      return progressOf(taskStages, runs);
    });
  }

  /** Every reason `edit` would refuse the edited Stages now, for the editor to flag before Save. */
  async check(taskId: string, edited: readonly Stage[]): Promise<readonly StageProblem[]> {
    return (await this.review(taskId, edited)).problems;
  }

  /**
   * Why nobody can work the Task's Stages from where it goes on: a Role nobody fills, or whose
   * person only talks. Empty for a Task without Stages of its own yet.
   */
  async staffingProblems(taskId: string): Promise<readonly StageProblem[]> {
    const own = await this.find(taskId);
    if (!own) return [];
    const runs = await this.runs.list(taskId);
    const stages = walkedStages(own.stages, runs);
    const fromIndex = firstStageToWork(stages, runs);
    return staffingProblems(stages, fromIndex, await this.roleFillings.of(stages));
  }

  /**
   * Runs `work` with the Task's own Stages while no edit can change them, as the walk reads its next
   * move and starts the run it leads to.
   */
  async holding<Result>(
    taskId: string,
    work: (own: TaskStages) => Promise<Result>,
  ): Promise<Result> {
    return this.changes.run(taskId, async () => {
      const own = await this.find(taskId);
      if (!own) throw new Error(`Task ${taskId} has no Stages of its own to walk.`);
      return work(own);
    });
  }

  /** Keeps the trace the Task's first walk began, for every later walk to join. */
  async saveTrace(taskId: string, trace: TaskTrace): Promise<void> {
    await this.repository.saveTrace(taskId, trace);
  }

  /** A swap before Start sets aside Stages edited for the old Pipeline: the Task follows the new. */
  private async reset(taskId: string, pipelineId: string): Promise<void> {
    await this.changes.run(taskId, async () => {
      const own = await this.repository.find(taskId);
      if (!own || followsPipeline(own, pipelineId)) return;
      await this.repository.remove(taskId);
      await this.events.publish(new TaskStagesReset(taskId, own.pipelineId));
    });
  }

  /**
   * The edit is weighed as the Task's own Stages alone: the editor shows Resolve's too, which The
   * Office puts back as the walk goes.
   */
  private async review(taskId: string, shown: readonly Stage[]): Promise<ReviewedEdit> {
    const edited = withoutResolveStages(shown);
    const { state, pipelineId, projectId } = await this.tasks.read(taskId);
    const own = await this.ownOrCopied(taskId, pipelineId);
    const runs = await this.runs.list(taskId);
    const keptBecause = whyStagesAreKept(state);
    const problems = keptBecause
      ? [{ text: keptBecause }]
      : [
          ...editProblems(own, edited, runs, await this.roleFillings.of(edited)),
          ...(await this.roleFillings.permissionProblems(
            edited,
            lockedStageCount(own.stages, runs),
          )),
          ...(await this.roleEngineProblems(edited, own, projectId)),
        ];
    return { own, runs, problems };
  }

  /**
   * Only Roles neither the Task's Stages nor the library name yet are weighed, in the Task's Project,
   * the only place its sessions run: the others already passed the check (spec §5.4).
   */
  private async roleEngineProblems(
    edited: readonly Stage[],
    own: TaskStages,
    projectId: string,
  ): Promise<StageProblem[]> {
    const named = new Set([...agentStageRoles(own.stages), ...(await this.library.rolesNamed())]);
    const problems = await this.roleEngines.newlyNamedRolesProblems({
      roleKeys: newlyNamedRoles(agentStageRoles(edited), named),
      projectId,
    });
    return problems.map((text) => ({ text }));
  }

  private async ownOrCopied(taskId: string, pipelineId: string): Promise<TaskStages> {
    const own = await this.repository.find(taskId);
    if (own && followsPipeline(own, pipelineId)) return own;
    return makeTaskStages(taskId, await this.pipeline(taskId, pipelineId), new Date()).taskStages;
  }

  private async pipeline(taskId: string, pipelineId: string): Promise<Pipeline> {
    const pipeline = await this.library.find(pipelineId);
    if (!pipeline) throw new Error(`There is no Pipeline "${pipelineId}" for Task ${taskId}.`);
    return pipeline;
  }
}

/** The user's edit weighed against the Task's own Stages and their runs. */
interface ReviewedEdit {
  readonly own: TaskStages;
  readonly runs: readonly StageRun[];
  readonly problems: readonly StageProblem[];
}

function progressOf(own: TaskStages, runs: readonly StageRun[]): TaskProgress {
  const stages = walkedStages(own.stages, runs);
  return {
    stages: stagesProgress(stages, runs),
    editedForTask: own.editedForTask,
    lockedStages: lockedStageCount(stages, runs),
    definitionOfDoneMet: reportedMet(runs),
  };
}
