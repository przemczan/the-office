import { Injectable, type OnModuleInit } from "@nestjs/common";
import { installFailure, scriptStageOutcome } from "../domain/script-stage-outcome.js";
import { stageCommitMessage } from "../domain/stage-commit.js";
import { acceptedIssues } from "../domain/walk-decisions.js";
import type { ExpectedHead } from "../domain/stage-commit.js";
import {
  commandRunsOf,
  failedInstall,
  installRuns,
  type StageCommandRun,
} from "../domain/stage-command-run.js";
import { interruptedOutcome } from "../domain/stage-interruption.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskCommands } from "../ports/task-commands.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
import { StageGit } from "./stage-git.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/**
 * Runs Script Stages (spec §2.3): the Stage's Project command in the Task's worktree with the
 * Project's environment and no model call, after the dependencies' install. The commands' runs are
 * recorded on the Stage run, and the last one's result is its outcome. git is checked before and
 * after (spec §5.5); a test run leaves the worktree restored, so only a build or lint commits what
 * it changed. A command can't be stopped by the user (spec §2.4): only The Office shutting down
 * stops it, which ends the run interrupted.
 */
@Injectable()
export class ScriptStageRunner implements StageRunner<"script">, OnModuleInit {
  constructor(
    private readonly runners: StageRunners,
    private readonly records: TaskRecords,
    private readonly commands: TaskCommands,
    private readonly stageGit: StageGit,
    private readonly runs: StageRunRepository,
  ) {}

  onModuleInit(): void {
    this.runners.register("script", this);
  }

  async run(work: StageWork<"script">): Promise<StageOutcome> {
    const { stage, run } = work;
    const command = stage.command;
    if (command === "publish") {
      return { status: "failed", error: "The Office can't run a Publish Stage yet." };
    }
    const task = await this.records.read(run.taskId);
    const { expected, refusal } = await this.stageGit.start(work, task);
    if (refusal) return refusal;
    const { commandsSignal } = work.interruption;
    const installation = await this.commands.install(task.project.id, run.taskId, commandsSignal);
    const installed = installRuns(installation);
    if (anyStopped(installed)) return this.stopped(work, task, expected, installed);
    const failed = failedInstall(installation);
    if (failed) {
      await this.runs.saveCommandRuns(run.id, installed);
      await this.stageGit.leaveAt(run, expected);
      return {
        status: "failed",
        error: `${installFailure(failed)}\n\nThe Stage's command didn't run.`,
      };
    }
    const commandRuns = await this.commands.runCommand(
      task.project.id,
      run.taskId,
      command,
      run.id,
      commandsSignal,
    );
    const ran = [...installed, ...commandRunsOf(commandRuns)];
    if (anyStopped(ran)) return this.stopped(work, task, expected, ran);
    await this.runs.saveCommandRuns(run.id, ran);
    const outcome = scriptStageOutcome(commandRuns);
    const moved = await this.stageGit.checkHead(run, task, expected);
    if (moved) return commandChangedGit(moved);
    if (command === "test") await this.stageGit.leaveAt(run, expected);
    else {
      const message = stageCommitMessage(
        stage.name,
        outcome,
        acceptedIssues(work.stages, work.earlierRuns),
      );
      await this.stageGit.commit(run, task, expected, message);
    }
    return outcome;
  }

  /**
   * Ends a run whose commands The Office stopped, as it does only when shutting down: interrupted,
   * not failed by what the stopped command printed, and with what it left uncommitted discarded.
   */
  private async stopped(
    { run, interruption }: StageWork<"script">,
    task: TaskRecord,
    expected: ExpectedHead,
    ran: readonly StageCommandRun[],
  ): Promise<StageOutcome> {
    const stoppedBy = interruption.requested;
    if (!stoppedBy) {
      throw new Error(`Stage run ${run.id}'s commands stopped, yet nothing interrupted it.`);
    }
    await this.runs.saveCommandRuns(run.id, ran);
    const moved = await this.stageGit.checkHead(run, task, expected);
    if (moved) return commandChangedGit(moved);
    const discarded = await this.stageGit.settleInterrupted(run, task, expected, stoppedBy);
    return interruptedOutcome(stoppedBy, discarded, { cutShort: interruption.cutShort });
  }
}

/** Only The Office stops a command; one that ended by itself first gives the run its outcome. */
function anyStopped(runs: readonly StageCommandRun[]): boolean {
  return runs.some(({ outcome }) => outcome === "stopped");
}

function commandChangedGit(moved: string): StageOutcome {
  return {
    status: "failed",
    error: `The Stage's command changed git itself: ${moved}. The Office stopped here without committing.`,
  };
}
