import { Injectable } from "@nestjs/common";
import { asFlow } from "../domain/flow.js";
import { RestartRefused } from "../domain/restart-refused.js";
import { runsOfLatestStart } from "../domain/start-over.js";
import type { HoldingUser, StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks, type RestartingPerson } from "../ports/started-tasks.js";
import { TaskRecords } from "../ports/task-records.js";
import { StageGit } from "./stage-git.js";
import { TaskStagesService } from "./task-stages-service.js";

/** What the user restarts a Task from: a Stage of its Pipeline, by key, with optional feedback. */
export interface RestartChoice {
  readonly stageKey: string;
  readonly feedback?: string | undefined;
}

/**
 * Restart from… on a Task the user paused or stopped (spec §2.4.5, "Restart from"): the held run
 * keeps the restart, its uncommitted edits discarded, and the Task goes on In progress, the walk
 * running the chosen Stage next and going on from it by its routes (`nextMove`). The user's click
 * and the `restart_task_from` Office tool both call it (`PipelinesOfficeActions`).
 */
@Injectable()
export class TaskRestarts {
  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly runs: StageRunRepository,
    private readonly tasks: StartedTasks,
    private readonly records: TaskRecords,
    private readonly stageGit: StageGit,
  ) {}

  /**
   * Restarts the Task from the chosen Stage for `byUser`, by `person` when they restart it at the
   * user's request; refused (`RestartRefused`) with every reason.
   */
  async restart(
    taskId: string,
    choice: RestartChoice,
    byUser: HoldingUser,
    person?: RestartingPerson,
  ): Promise<void> {
    const feedback = choice.feedback?.trim() || undefined;
    const by = { userId: byUser.userId, name: byUser.name };
    if (!(await this.taskStages.find(taskId))) {
      throw new RestartRefused([
        ...(await this.tasks.restartProblems(taskId)),
        "No Stage of the Task has run yet: Resume it instead.",
      ]);
    }
    // Under the Task's lock, so no walk starts a run between the checks and the record.
    const stageName = await this.taskStages.holding(taskId, async ({ stages }) => {
      const flow = asFlow(stages);
      const stage = flow.find(({ key }) => key === choice.stageKey);
      const runs = runsOfLatestStart(await this.runs.list(taskId));
      const held = runs.at(-1);
      const problems = [
        ...(await this.tasks.restartProblems(taskId)),
        ...(stage ? [] : [`"${choice.stageKey}" isn't a Stage of the Task's Pipeline.`]),
        ...heldRunProblems(held),
      ];
      if (problems.length > 0 || !stage || !held) throw new RestartRefused(problems);
      if (!(await this.runs.saveRestart(held.id, { stageKey: stage.key, feedback, byUser: by }))) {
        throw new RestartRefused(["The Task was restarted already."]);
      }
      // Pause kept the held run's edits; a restart discards them, as Stop does.
      const task = await this.records.read(taskId);
      await this.stageGit.discardHeld({ run: held, earlierRuns: runs.slice(0, -1) }, task);
      return stage.name;
    });
    await this.tasks.restart(taskId, { stageName, by, person });
  }
}

/** Why the Task's latest run can't be restarted from: none, or still ending its turn. */
function heldRunProblems(held: StageRun | undefined): string[] {
  if (!held) return ["No Stage of the Task has run yet: Resume it instead."];
  if (!held.outcome) return ["Its Stage is still ending its turn: try again in a moment."];
  return [];
}
