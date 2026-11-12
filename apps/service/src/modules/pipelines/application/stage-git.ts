import { Injectable } from "@nestjs/common";
import {
  branchKept,
  branchMovedWords,
  branchUpdateWords,
  headProblem,
  type ExpectedHead,
} from "../domain/stage-commit.js";
import { baseWords } from "../domain/base-words.js";
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
  /** The run's failure when HEAD moved somewhere only the user can judge; the Stage doesn't start. */
  readonly refusal: StageOutcome | undefined;
  /** What the Stage's Agent should know of how the branch changed since the last Stage. */
  readonly branchNews: string | undefined;
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

  /**
   * Where the Stage expects HEAD, the Task's first Stage bringing the branch to the base first:
   * planning made it, maybe long ago. Not where The Office left it, HEAD is taken as it is when the
   * user said to keep it or it moved along the base; any other move refuses the Stage (spec §2.3).
   */
  async start(work: StageAt, task: TaskRecord): Promise<StageStart> {
    const updateNews = await this.updatedForFirstStage(work, task);
    const expected = await this.expectedHead(work, task);
    const head = await this.git.head(task.project.id, work.run.taskId);
    const problem = headProblem(expected, head);
    if (problem === undefined) return { expected, refusal: undefined, branchNews: updateNews };
    if (head.branch === expected.branch && (await this.takesMove(work, task, expected))) {
      return {
        expected: { ...expected, commit: head.commit },
        refusal: undefined,
        branchNews: branchMovedWords(expected.commit, head.commit),
      };
    }
    await this.runs.saveHeadCommit(work.run.id, expected.commit);
    return {
      expected,
      branchNews: undefined,
      refusal: {
        status: "failed",
        error: `The Task's worktree isn't where The Office left it: ${problem}. The Stage didn't start.`,
        branchMoved: true,
      },
    };
  }

  /** Brings the branch to the base before the Task's first Stage; what its Agent should know. */
  private async updatedForFirstStage(
    { run, earlierRuns }: StageAt,
    task: TaskRecord,
  ): Promise<string | undefined> {
    if (earlierRuns.some(({ headCommit }) => headCommit !== undefined)) return undefined;
    const update = await this.git.updateFromBase(task.project.id, run.taskId, "give-back");
    return branchUpdateWords(update, baseWords(task));
  }

  private async takesMove(
    { run, earlierRuns }: StageAt,
    task: TaskRecord,
    expected: ExpectedHead,
  ): Promise<boolean> {
    if (branchKept(earlierRuns)) return true;
    return this.git.movedAlongBase(task.project.id, run.taskId, expected.commit);
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

  /** Where the run expects HEAD now: as it began, unless its Agent's branch update moved it. */
  async afterTurn(run: StageRun, expected: ExpectedHead): Promise<ExpectedHead> {
    const runs = await this.runs.list(run.taskId);
    const left = runs.find(({ id }) => id === run.id)?.headCommit;
    return left === undefined ? expected : { ...expected, commit: left };
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
   * Ends the edits of a run The Office left running as it stopped, found as it starts again, as
   * `interruption` says, from where the run expected HEAD.
   */
  async settleLeftRunning(
    work: StageAt,
    task: TaskRecord,
    interruption: StageInterruption,
  ): Promise<readonly string[]> {
    const expected = await this.expectedHead(work, task);
    return this.settleInterrupted(work.run, task, expected, interruption);
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
    // A run's own record, on one The Office left running, is its Agent's branch update.
    const left =
      run.headCommit ??
      earlierRuns.findLast(({ headCommit }) => headCommit !== undefined)?.headCommit;
    const commit = left ?? (await this.git.head(task.project.id, run.taskId)).commit;
    return { commit, branch: task.worktree.branch };
  }
}
