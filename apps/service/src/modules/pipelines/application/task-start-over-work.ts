import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  LEFT_THE_WORKSTATION,
  TaskStartOvers,
  type StartedOverWork,
  type StartingOverUser,
  type StartOverWork,
} from "../../work/index.js";
import { asFlow } from "../domain/flow.js";
import { RestartRefused } from "../domain/restart-refused.js";
import {
  runsOfLatestStart,
  startOverRecord,
  startedOverRef,
  startOversOf,
  workLeftTheWorkstation,
} from "../domain/start-over.js";
import { keepStartedOver } from "../domain/stage-run-changes.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskRecords } from "../ports/task-records.js";
import { StageGit } from "./stage-git.js";
import { TaskStagesService } from "./task-stages-service.js";

/**
 * Pipelines' part of the user's Start over, and of Reopen… of a Dropped Task that had started (spec
 * §2.4.5, "Start over"), which Work's `TaskStartOvers` asks for: the Task's runs so far become
 * history only, kept as the last run's `startedOver`, so the walk, the rail, routes' times, Not
 * taken and Reported met read only the runs after it (`runsOfLatestStart`), and the next Start opens
 * fresh Stage sessions; with a reset, the branch goes back to its freshly fetched base, its old head
 * kept under `refs/office/started-over/<task id>/<n>`.
 */
@Injectable()
export class TaskStartOverWork implements StartOverWork, OnModuleInit {
  constructor(
    private readonly startOvers: TaskStartOvers,
    private readonly runs: StageRunRepository,
    private readonly taskStages: TaskStagesService,
    private readonly records: TaskRecords,
    private readonly stageGit: StageGit,
  ) {}

  onModuleInit(): void {
    this.startOvers.register(this);
  }

  async refusals(taskId: string): Promise<readonly string[]> {
    const last = (await this.runs.list(taskId)).at(-1);
    if (last && !last.outcome)
      return ["Its Stage is still ending its turn: try again in a moment."];
    return [];
  }

  /**
   * A pushed branch isn't reset: the next Publish pushes without force, so it builds on the branch
   * and pull request as they are (spec §2.4.5, "Start over").
   */
  async branchResetRefusals(taskId: string): Promise<readonly string[]> {
    const allRuns = await this.runs.list(taskId);
    const stages = asFlow((await this.taskStages.stagesToWork(taskId)) ?? []);
    return workLeftTheWorkstation(stages, allRuns) ? [LEFT_THE_WORKSTATION] : [];
  }

  async resetTo(taskId: string): Promise<string> {
    const { project, initiativeBranch, publishingTask } = await this.records.read(taskId);
    // A Publishing Task's own branch is its Initiative's, whose base is the base branch.
    return publishingTask ? project.baseBranch : (initiativeBranch ?? project.baseBranch);
  }

  async hadStarted(taskId: string): Promise<boolean> {
    return runsOfLatestStart(await this.runs.list(taskId)).length > 0;
  }

  async startOver(
    taskId: string,
    { resetBranch, by }: { readonly resetBranch: boolean; readonly by: StartingOverUser },
  ): Promise<StartedOverWork> {
    const refused = [
      ...(await this.refusals(taskId)),
      ...(resetBranch ? await this.branchResetRefusals(taskId) : []),
    ];
    if (refused.length > 0) throw new RestartRefused(refused);
    const allRuns = await this.runs.list(taskId);
    const number = startOversOf(allRuns) + 1;
    const reset = resetBranch ? await this.resetBranch(taskId, number) : undefined;
    // A Task with no run since its latest Start over has no walk to leave behind.
    const last = runsOfLatestStart(allRuns).at(-1);
    if (last) {
      const startedOver = startOverRecord(number, by, new Date(), reset);
      await this.runs.update(last.id, (run) => keepStartedOver(run, startedOver));
    }
    return { resetTo: reset?.resetTo, keptRef: reset?.keptRef };
  }

  private async resetBranch(
    taskId: string,
    number: number,
  ): Promise<{ readonly resetTo: string; readonly keptRef: string }> {
    const keptRef = startedOverRef(taskId, number);
    const task = await this.records.read(taskId);
    const resetTo = await this.stageGit.resetForStartOver(task, taskId, keptRef);
    return { resetTo, keptRef };
  }
}
