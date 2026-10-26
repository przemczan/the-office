import { Injectable } from "@nestjs/common";
import { headProblem, type ExpectedHead } from "../domain/stage-commit.js";
import { actsNow } from "../domain/stage-interruption.js";
import type { StageInterruption, StageOutcome, StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskGit } from "../ports/task-git.js";
import type { TaskRecord } from "../ports/task-records.js";
import type { StageWork } from "./stage-runner.js";

/** The run of a Stage of any kind, with the Task's runs before it. */
type StageAt = Pick<StageWork, "run" | "earlierRuns">;

/** Where a Stage starts from, or why it can't start. */
export interface StageStart {
  readonly expected: ExpectedHead;
  /** The run's failure when HEAD isn't where The Office left it; the Stage doesn't start. */
  readonly refusal: StageOutcome | undefined;
}

/**
 * The git The Office does around every Stage (spec §5.5): HEAD and the Task's branch checked
 * before and after it, against where The Office last left them, and the Stage's work committed.
 * Each run records where it left the branch, so the next Stage knows where to expect it.
 */
@Injectable()
export class StageGit {
  constructor(
    private readonly git: TaskGit,
    private readonly runs: StageRunRepository,
  ) {}

  /** Where the Stage expects HEAD, and a refusal when it isn't there. */
  async start(work: StageAt, task: TaskRecord): Promise<StageStart> {
    const expected = await this.expectedHead(work, task);
    const problem = await this.checkHead(work.run, task, expected);
    return {
      expected,
      refusal:
        problem === undefined
          ? undefined
          : {
              status: "failed",
              error: `The Task's worktree isn't where The Office left it: ${problem}. The Stage didn't start; put the branch back to go on.`,
            },
    };
  }

  /**
   * How HEAD differs from where The Office left it, or undefined when it is there. On a
   * difference the run keeps the expected commit, so the Stages after it expect the same place.
   */
  async checkHead(
    run: StageRun,
    task: TaskRecord,
    expected: ExpectedHead,
  ): Promise<string | undefined> {
    const problem = headProblem(expected, await this.git.head(task.project.id, run.taskId));
    if (problem) await this.runs.saveHeadCommit(run.id, expected.commit);
    return problem;
  }

  /** Commits every change in the worktree with `message`, and records where the branch is now. */
  async commit(
    run: StageRun,
    task: TaskRecord,
    expected: ExpectedHead,
    message: string,
  ): Promise<void> {
    const commit = await this.git.commit(task.project.id, run.taskId, message);
    await this.runs.saveHeadCommit(run.id, commit ?? expected.commit);
  }

  /**
   * Drops what the run left uncommitted, as for a Stage the user stopped, and records that it left
   * the branch where it found it. Returns the dropped paths.
   */
  async discard(
    run: StageRun,
    task: TaskRecord,
    expected: ExpectedHead,
  ): Promise<readonly string[]> {
    const discarded = await this.git.discard(task.project.id, run.taskId);
    await this.leaveAt(run, expected);
    return discarded;
  }

  /**
   * Ends an interrupted run's edits as the interruption says, committing nothing: discarded after
   * one that acts now, kept after a Pause. Returns the discarded paths.
   */
  async settleInterrupted(
    run: StageRun,
    task: TaskRecord,
    expected: ExpectedHead,
    interruption: StageInterruption,
  ): Promise<readonly string[]> {
    if (actsNow(interruption)) return this.discard(run, task, expected);
    await this.leaveAt(run, expected);
    return [];
  }

  /**
   * Ends the edits of a run The Office left running as it stopped, found as it starts again:
   * discarded as a restart says, from where the run expected HEAD.
   */
  async settleLeftRunning(work: StageAt, task: TaskRecord): Promise<readonly string[]> {
    const expected = await this.expectedHead(work, task);
    return this.settleInterrupted(work.run, task, expected, "restart");
  }

  /** Records that the run left the branch where it found it, committing nothing. */
  async leaveAt(run: StageRun, expected: ExpectedHead): Promise<void> {
    await this.runs.saveHeadCommit(run.id, expected.commit);
  }

  /**
   * The Task's branch at the commit The Office last left it at; at the Task's first Stage, where
   * planning left it.
   */
  private async expectedHead(
    { run, earlierRuns }: StageAt,
    task: TaskRecord,
  ): Promise<ExpectedHead> {
    const left = earlierRuns.findLast(({ headCommit }) => headCommit !== undefined)?.headCommit;
    const commit = left ?? (await this.git.head(task.project.id, run.taskId)).commit;
    return { commit, branch: task.worktree.branch };
  }
}
