import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import type { DutyKey } from "../../people/index.js";
import { TaskMovedToProject, TaskPipelineConfirmed, TaskStageEdits } from "../../work/index.js";
import { asFlow } from "../domain/flow.js";
import { pipelineProblem, type Pipeline, type StageProblem } from "../domain/pipeline.js";
import type { StagePosition } from "../domain/route.js";
import {
  agentStageWorkers,
  mergedWorkers,
  newlyNamedWorkers,
  NO_STAGE_WORKERS,
  type Stage,
  type StageWorkers,
} from "../domain/stage.js";
import { reportedMet, reportedOutOfReach } from "../domain/definition-of-done-reports.js";
import { gateChecksDefinitionOfDone } from "../domain/pipeline-walk.js";
import { stagesProgress, type TaskProgress } from "../domain/stage-progress.js";
import type { StageRun } from "../domain/stage-run.js";
import { runsOfLatestStart } from "../domain/start-over.js";
import { staffingProblems } from "../domain/stage-staffing.js";
import { StagesEditRefused } from "../domain/stages-edit-refused.js";
import {
  editProblems,
  editTaskStages,
  firstStageToWork,
  followsPipeline,
  lockedStageCount,
  makeTaskStages,
  startedStageKeys,
  whyStagesAreKept,
  type TaskStages,
  type TaskTrace,
} from "../domain/task-stages.js";
import { TaskStagesReset } from "../domain/task-stages-events.js";
import { commandsWords, missingCommandsOnStages } from "../domain/stage-commands.js";
import { ProjectDefaults } from "../ports/project-defaults.js";
import { StageRoleEngines, type StageRolesNamed } from "../ports/stage-role-engines.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";
import { PipelineLibrary } from "./pipeline-library.js";
import { RoleFillings } from "./role-fillings.js";

/**
 * Each Task's own Stages: copied from its Pipeline as the Task starts, or as the user first edits
 * them for the Task (an office-wide Pipeline's Stages, or a Project Pipeline's as built then), so
 * saving the library later reaches only Tasks that follow it (spec §2.3). Changes to a Task's Stages, and the walk's start of each run, go one at a time per Task,
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
    private readonly projects: ProjectDefaults,
    private readonly stageEdits: TaskStageEdits,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskPipelineConfirmed, ({ taskId, pipelineId }) =>
      this.reset(taskId, pipelineId),
    );
    this.events.subscribe(TaskMovedToProject, ({ taskId }) => this.reset(taskId));
    this.stageEdits.register((taskId) => this.editedForTask(taskId));
  }

  /** Whether the user edited the Task's own Stages for it, so a Pipeline swap leaves them be. */
  async editedForTask(taskId: string): Promise<boolean> {
    return (await this.repository.find(taskId))?.editedForTask ?? false;
  }

  /**
   * The Task's own Stages as it starts: those it has for its Pipeline, or a copy of the Pipeline's;
   * refused for a Broken Project Pipeline. Work refuses Start for a Pipeline the library doesn't
   * have, so a missing one is a fault.
   */
  async make(taskId: string, pipelineId: string): Promise<TaskStages> {
    return this.changes.run(taskId, async () => {
      const existing = await this.repository.find(taskId);
      if (existing && followsPipeline(existing, pipelineId)) return existing;
      const { projectId } = await this.tasks.read(taskId);
      const pipeline = await this.pipeline(taskId, pipelineId, projectId);
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
    return (
      own &&
      progressOf(own, await this.runs.list(taskId), await this.roleFillings.holders(own.stages))
    );
  }

  /** What each command of the Task's run printed, in its order; undefined for no such run. */
  commandOutputs(taskId: string, runId: string): Promise<readonly string[] | undefined> {
    return this.runs.commandOutputs(taskId, runId);
  }

  /**
   * The user's edit of the Task's Stages for that Task, which leaves the library Pipeline as it is;
   * refused with every reason the edited Stages can't run, or change a Stage that has started.
   */
  async edit(
    taskId: string,
    edited: readonly Stage[],
    endPosition?: StagePosition,
  ): Promise<TaskProgress> {
    return this.changes.run(taskId, async () => {
      const { own, allRuns, problems } = await this.review(taskId, edited);
      if (problems.length > 0) throw new StagesEditRefused(problems);
      const { taskStages, event } = editTaskStages(own, edited, endPosition);
      await this.repository.save(taskStages);
      await this.events.publish(event);
      return progressOf(taskStages, allRuns, await this.roleFillings.holders(taskStages.stages));
    });
  }

  /**
   * Every reason `edit` would refuse the edited Stages now, for the editor to flag before Save; with
   * `pipelineId`, as if the Task followed that Pipeline, as a draft does that chooses or swaps it.
   */
  async check(
    taskId: string,
    edited: readonly Stage[],
    pipelineId?: string,
  ): Promise<readonly StageProblem[]> {
    return (await this.review(taskId, edited, pipelineId)).problems;
  }

  /**
   * Why nobody can work the Task's Stages from where it goes on: a Role nobody fills, a duty nobody
   * holds, or a person who only talks. Each Stage naming a duty is weighed as it would start now.
   * Empty for a Task without Stages of its own yet.
   */
  async staffingProblems(taskId: string): Promise<readonly StageProblem[]> {
    const own = await this.find(taskId);
    if (!own) return [];
    const runs = runsOfLatestStart(await this.runs.list(taskId));
    const stages = asFlow(await this.roleFillings.staffed(own.stages, runs));
    const before = stages.slice(0, firstStageToWork(stages, runs)).map(({ key }) => key);
    return staffingProblems(stages, new Set(before), await this.roleFillings.of(stages));
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

  /**
   * A swap before Start sets aside Stages edited for the old Pipeline: the Task follows the new. A
   * Move sets them aside (no `pipelineId`): they were edited for the old Project, and the Task has
   * no Pipeline there until one is chosen.
   */
  private async reset(taskId: string, pipelineId?: string): Promise<void> {
    await this.changes.run(taskId, async () => {
      const own = await this.repository.find(taskId);
      if (!own || (pipelineId !== undefined && followsPipeline(own, pipelineId))) return;
      await this.repository.remove(taskId);
      await this.events.publish(new TaskStagesReset(taskId, own.pipelineId));
    });
  }

  /** The edit is weighed as given. `followed` weighs it against that Pipeline in place of the Task's own. */
  private async review(
    taskId: string,
    shown: readonly Stage[],
    followed?: string,
  ): Promise<ReviewedEdit> {
    const edited = asFlow(shown);
    const task = await this.tasks.read(taskId);
    const { state, projectId } = task;
    const pipelineId = followed ?? task.pipelineId;
    if (pipelineId === undefined) {
      throw new StagesEditRefused([
        pipelineProblem("The Task has no Pipeline yet: choose one first."),
      ]);
    }
    const own = await this.ownOrCopied(taskId, pipelineId, projectId);
    const allRuns = await this.runs.list(taskId);
    const runs = runsOfLatestStart(allRuns);
    const started = startedStageKeys(runs);
    const keptBecause = whyStagesAreKept(state);
    const problems = keptBecause
      ? [pipelineProblem(keptBecause)]
      : [
          ...editProblems(own, edited, runs, await this.roleFillings.of(edited)),
          ...(await this.roleFillings.permissionProblems(edited, started)),
          ...(await this.roleEngineProblems(taskId, edited, own, projectId)),
          ...(await this.missingCommandProblems(edited, started, projectId)),
        ];
    return { own, allRuns, problems };
  }

  /** The commands the Stages not started yet name that the Task's Project lacks. */
  private async missingCommandProblems(
    edited: readonly Stage[],
    started: ReadonlySet<string>,
    projectId: string,
  ): Promise<StageProblem[]> {
    const project = (await this.projects.list()).find(({ id }) => id === projectId);
    if (!project) return [];
    return missingCommandsOnStages(
      edited,
      project.commands,
      started,
      (keys) => `its Project, ${project.name}, has no ${commandsWords(keys)}.`,
    );
  }

  /**
   * Only Roles neither the Task's Stages, the library nor its Project's Project Pipelines name yet
   * are weighed, in the Task's Project, the only place its sessions run: the others already passed
   * the check (spec §5.4). While the Task or its Initiative has an engine override, People weighs whom
   * the edit names against whom the Task's Stages name now, at that override alone (`task`).
   */
  private async roleEngineProblems(
    taskId: string,
    edited: readonly Stage[],
    own: TaskStages,
    projectId: string,
  ): Promise<StageProblem[]> {
    const [library, byProject] = await Promise.all([
      this.library.rolesNamed(),
      this.library.rolesNamedByProject(),
    ]);
    const named = mergedWorkers(
      agentStageWorkers(own.stages),
      library,
      byProject.get(projectId) ?? NO_STAGE_WORKERS,
    );
    const problems = await this.roleEngines.newlyNamedRolesProblems({
      ...newlyNamedWorkers(agentStageWorkers(edited), named),
      projectId,
      task: {
        taskId,
        before: namedRoles(agentStageWorkers(own.stages)),
        after: namedRoles(agentStageWorkers(edited)),
      },
    });
    return problems.map(pipelineProblem);
  }

  /**
   * The Stages the Task works: its own when it has them for its Pipeline, else its Pipeline's as
   * built now; undefined while it has no Pipeline, or one Broken or not found.
   */
  async stagesToWork(taskId: string): Promise<readonly Stage[] | undefined> {
    const { pipelineId, projectId } = await this.tasks.read(taskId);
    if (pipelineId === undefined) return undefined;
    const own = await this.repository.find(taskId);
    if (own && followsPipeline(own, pipelineId)) return own.stages;
    const found = await this.library.forTask(pipelineId, projectId);
    return found.kind === "found" ? found.pipeline.stages : undefined;
  }

  private async ownOrCopied(
    taskId: string,
    pipelineId: string,
    projectId: string,
  ): Promise<TaskStages> {
    const own = await this.repository.find(taskId);
    if (own && followsPipeline(own, pipelineId)) return own;
    const pipeline = await this.pipeline(taskId, pipelineId, projectId);
    return makeTaskStages(taskId, pipeline, new Date()).taskStages;
  }

  /** The Pipeline the Task copies its Stages from: an office-wide one, or one of its Project's. */
  private async pipeline(taskId: string, pipelineId: string, projectId: string): Promise<Pipeline> {
    const found = await this.library.forTask(pipelineId, projectId);
    switch (found.kind) {
      case "found":
        return found.pipeline;
      case "broken": {
        const project = (await this.projects.list()).find(({ id }) => id === projectId);
        throw new StagesEditRefused([
          pipelineProblem(
            `${found.name} was Broken before The Office updated: ${found.reasons.join(" ")} Save it once in ${project?.name ?? projectId}'s Pipelines, or choose another Pipeline.`,
          ),
        ]);
      }
      case "unknown":
        // Neither the library nor the Task's Project has it, as with another Project's Pipeline.
        throw new StagesEditRefused([
          pipelineProblem(
            `There is no Pipeline "${pipelineId}" that Task ${taskId}'s Project can follow; choose another Pipeline.`,
          ),
        ]);
    }
  }
}

/** Whom Stage workers name, as People's capability check takes them. */
export function namedRoles(workers: StageWorkers): StageRolesNamed {
  return { roleKeys: [...workers.roles], dutyKeys: [...workers.duties] };
}

/** The user's edit weighed against the Task's own Stages and their runs. */
interface ReviewedEdit {
  readonly own: TaskStages;
  /** Every run of the Task, those of earlier starts included. */
  readonly allRuns: readonly StageRun[];
  readonly problems: readonly StageProblem[];
}

/** Where the Task's Stages stand, from its runs since its latest Start over (spec §2.4.5). */
function progressOf(
  own: TaskStages,
  allRuns: readonly StageRun[],
  holders: ReadonlyMap<DutyKey, string>,
): TaskProgress {
  const stages = asFlow(own.stages);
  const runs = runsOfLatestStart(allRuns);
  return {
    stages: stagesProgress(stages, allRuns, holders),
    ...(own.endPosition && { endPosition: own.endPosition }),
    editedForTask: own.editedForTask,
    lockedStages: lockedStageCount(stages, runs),
    definitionOfDoneMet: reportedMet(runs),
    definitionOfDoneOutOfReach: reportedOutOfReach(runs),
    gatesCheckingDefinitionOfDone: stages
      .filter((_stage, index) => gateChecksDefinitionOfDone(stages, index))
      .map(({ key }) => key),
  };
}
