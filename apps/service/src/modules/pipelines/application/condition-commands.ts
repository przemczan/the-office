import { Injectable } from "@nestjs/common";
import { BusyWork } from "../../office-updates/index.js";
import type { NextMove } from "../domain/pipeline-walk.js";
import type { Stage } from "../domain/stage.js";
import { conditionRunsOf, failedInstall, installRuns } from "../domain/stage-command-run.js";
import type { StageRun } from "../domain/stage-run.js";
import { stageRunsFile } from "../domain/stage-runs-file.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskCommands } from "../ports/task-commands.js";
import type { TaskRecord } from "../ports/task-records.js";
import { setUpByOf } from "./command-set-up-by.js";
import { KnownPeople } from "../ports/known-people.js";
import { StageRunWaits } from "./stage-run-waits.js";
import { StageRunsFiles } from "./stage-runs-files.js";

/** The walk's ask for a condition command's result. */
export type WeighCommandMove = Extract<NextMove, { move: "weigh-command" }>;

/**
 * Runs the Project command a route's condition names (spec §2.3, "The Project-command condition"),
 * where a Script Stage's command runs, after the install, with the Task's earlier Stage runs in the
 * file `OFFICE_STAGE_RUNS_FILE` names. Its runs, the install's included, are added to the run of
 * the Stage the route leaves, which the walk replays its result from, so a restart never runs a
 * weighed command again. It is busy work a scheduled Office update waits for.
 */
@Injectable()
export class ConditionCommands {
  constructor(
    private readonly commands: TaskCommands,
    private readonly runs: StageRunRepository,
    private readonly files: StageRunsFiles,
    private readonly waits: StageRunWaits,
    private readonly busyWork: BusyWork,
    private readonly people: KnownPeople,
  ) {}

  /**
   * Weighs the move's command test on the Task's runs so far, the leaving run last. `stages` are
   * the Stages the walk walked, Resolve's included; `signal` stops the install or the command, which
   * is then recorded stopped, to be weighed again as the Task goes on.
   */
  weigh(
    move: WeighCommandMove,
    task: TaskRecord,
    stages: readonly Stage[],
    earlierRuns: readonly StageRun[],
    signal: AbortSignal,
  ): Promise<void> {
    const label = `The condition of the route from ${move.stage.name} to ${placeName(stages, move.condition.to)}`;
    return this.busyWork.during({ kind: "script-stage", label }, () =>
      this.runCommand(move, task, stages, earlierRuns, signal),
    );
  }

  private async runCommand(
    { run, stage, condition, route }: WeighCommandMove,
    task: TaskRecord,
    stages: readonly Stage[],
    earlierRuns: readonly StageRun[],
    signal: AbortSignal,
  ): Promise<void> {
    const projectId = task.project.id;
    const options = { signal, wait: this.waits.of(run) };
    try {
      const installation = await this.commands.install(projectId, run.taskId, options);
      const installed = installRuns(installation, condition);
      if (failedInstall(installation)) {
        await this.runs.addCommandRuns(run.id, installed);
        return;
      }
      const file = stageRunsFile(
        { id: run.taskId, title: task.title, project: projectId },
        { from: stage.key, to: condition.to, times: route.times, limit: route.limit },
        task.definitionOfDone,
        earlierRuns,
        stages,
      );
      const path = await this.files.write(run.taskId, file);
      const ran = await this.commands.runConditionCommand(
        projectId,
        run.taskId,
        condition.key,
        path,
        run.id,
        { ...options, setUpBy: await setUpByOf(this.people) },
      );
      await this.runs.addCommandRuns(run.id, [
        ...installed,
        ...conditionRunsOf(ran.runs, condition, ran.inCarriedRunEnvironment),
      ]);
    } finally {
      // The run has ended: a wait stopped before its end is no wait any more.
      await this.runs.saveWaitingSince(run.id, undefined);
    }
  }
}

/** Where a route leads, by its Stage's name, or End. */
function placeName(stages: readonly Stage[], to: string | null): string {
  if (to === null) return "End";
  return stages.find(({ key }) => key === to)?.name ?? to;
}
