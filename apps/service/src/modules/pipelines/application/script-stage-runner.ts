import { Injectable, type OnModuleInit } from "@nestjs/common";
import { installFailure, scriptStageOutcome } from "../domain/script-stage-outcome.js";
import { stageCommitMessage } from "../domain/stage-commit.js";
import { commandRunsOf, failedInstall, installRuns } from "../domain/stage-command-run.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskCommands } from "../ports/task-commands.js";
import { TaskRecords } from "../ports/task-records.js";
import { StageGit } from "./stage-git.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/**
 * Runs Script Stages (spec §2.3): the Stage's Project command in the Task's worktree with the
 * Project's environment and no model call, after the dependencies' install. The commands' runs are
 * recorded on the Stage run, and the last one's result is its outcome. git is checked before and
 * after (spec §5.5); a test run leaves the worktree restored, so only a build or lint commits what
 * it changed.
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
    const installation = await this.commands.install(task.project.id, run.taskId);
    const installed = installRuns(installation);
    const failed = failedInstall(installation);
    if (failed) {
      await this.runs.saveCommandRuns(run.id, installed);
      await this.stageGit.leaveAt(run, expected);
      return {
        status: "failed",
        error: `${installFailure(failed)}\n\nThe Stage's command didn't run.`,
      };
    }
    const commandRuns = await this.commands.runCommand(task.project.id, run.taskId, command);
    await this.runs.saveCommandRuns(run.id, [...installed, ...commandRunsOf(commandRuns)]);
    const outcome = scriptStageOutcome(commandRuns);
    const moved = await this.stageGit.checkHead(run, task, expected);
    if (moved) {
      return {
        status: "failed",
        error: `The Stage's command changed git itself: ${moved}. The Office stopped here without committing.`,
      };
    }
    if (command === "test") await this.stageGit.leaveAt(run, expected);
    else await this.stageGit.commit(run, task, expected, stageCommitMessage(stage.name, outcome));
    return outcome;
  }
}
