import { Injectable } from "@nestjs/common";
import { baseWords } from "../domain/base-words.js";
import { RESOLVE_KEY } from "../domain/resolve-stages.js";
import { installFailure } from "../domain/script-stage-outcome.js";
import { failedInstall } from "../domain/stage-command-run.js";
import type { BranchUpdate } from "../domain/stage-commit.js";
import type { StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageRunWaits } from "./stage-run-waits.js";
import { StageThreads } from "../ports/stage-threads.js";
import { TaskCommands } from "../ports/task-commands.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";

/** What the Agent who asked is answered. */
export interface StageBranchUpdateAnswer {
  readonly text: string;
  readonly isError: boolean;
}

const NOT_IN_A_STAGE = "This tool works in a running Stage of a Task, and this session is in none.";
const RESOLVING =
  "This Stage is merging the base already: resolve what it left, and The Office commits it.";

/**
 * An Agent's ask, mid-Stage, for the Task's branch to have what the base has (spec §2.3): The
 * Office commits the Stage's work so far and merges the base in, since Agents never change git.
 * The run records where that left the branch, so the Stage's end expects HEAD there; a conflict
 * stays in the worktree for the Agent, and the Stage's end commits the merge.
 */
@Injectable()
export class StageBranchUpdate {
  constructor(
    private readonly threads: StageThreads,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly git: TaskGit,
    private readonly commands: TaskCommands,
    private readonly waits: StageRunWaits,
  ) {}

  async inSession(sessionId: string): Promise<StageBranchUpdateAnswer> {
    const taskId = await this.threads.taskInSession(sessionId);
    const run =
      taskId === undefined
        ? undefined
        : (await this.runs.list(taskId)).findLast(({ outcome }) => outcome === undefined);
    if (!run) return { text: NOT_IN_A_STAGE, isError: true };
    if (run.stageKey === RESOLVE_KEY) return { text: RESOLVING, isError: true };
    const task = await this.records.read(run.taskId);
    const projectId = task.project.id;
    if (!(await this.git.mergeInProgress(projectId, run.taskId))) {
      const message = `Work before updating from ${baseWords(task)}: ${task.title}`;
      const commit = await this.git.commit(projectId, run.taskId, message);
      if (commit !== undefined) await this.runs.saveHeadCommit(run.id, commit);
    }
    const update = await this.git.updateFromBase(projectId, run.taskId, "leave");
    // A clean merge of the Initiative's branch before a conflict with the base moved HEAD too.
    const movedTo =
      update.kind === "updated" || update.kind === "conflicted" ? update.commit : undefined;
    if (movedTo !== undefined) await this.runs.saveHeadCommit(run.id, movedTo);
    return {
      text: `${answerTo(update, baseWords(task))}${await this.installed(update, task, run)}`,
      isError: update.kind === "failed",
    };
  }

  /** Installs again after an update, whose changes may be the install inputs'. */
  private async installed(update: BranchUpdate, task: TaskRecord, run: StageRun): Promise<string> {
    if (update.kind !== "updated") return "";
    // The tool's caller waits for it, and only a restart stops an install, ending the call too.
    const { signal } = new AbortController();
    const failed = failedInstall(
      await this.commands.install(task.project.id, run.taskId, {
        signal,
        wait: this.waits.of(run),
      }),
    );
    return failed ? `\n\n${installFailure(failed)}` : "";
  }
}

/** `bases` names what the branch takes in (`baseWords`). */
function answerTo(update: BranchUpdate, bases: string): string {
  switch (update.kind) {
    case "up-to-date":
      return `The Task's branch is already up to date with ${bases}.`;
    case "updated":
      return `The Task's branch is now up to date with ${bases}, and your work so far is committed. Read again whatever you read before.`;
    case "conflicted":
      return `Merging ${update.from ?? bases} conflicts in these files, left with conflict markers in the worktree:\n${update.conflictedFiles.map((file) => `- ${file}`).join("\n")}\n\nResolve them by editing the files, keeping what both sides meant, and don't run git: The Office commits the merge when your Stage ends done, once no marker is left.`;
    case "failed":
      return `The Office couldn't update the Task's branch. git said: ${update.error}`;
  }
}
