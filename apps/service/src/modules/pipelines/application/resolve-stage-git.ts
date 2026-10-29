import { Injectable } from "@nestjs/common";
import {
  afterResolveTestFailed,
  conflictCameBackTooOften,
  resolveBrief,
  resolvedByTheUser,
} from "../domain/resolve-stages.js";
import type { ExpectedHead } from "../domain/stage-commit.js";
import type { StageOutcome, StageRun } from "../domain/stage-run.js";
import { TaskPublishing } from "../ports/task-publishing.js";
import type { TaskRecord } from "../ports/task-records.js";
import { StageGit } from "./stage-git.js";
import type { StageWork } from "./stage-runner.js";

/** How Resolve goes on before its Agent: ended already, or the Agent's turn with its Brief. */
export type ResolveBegun =
  | { readonly kind: "ended"; readonly outcome: StageOutcome }
  | {
      readonly kind: "agent";
      readonly brief: string;
      /** Whether a merge is in progress, which The Office commits after the Agent. */
      readonly merging: boolean;
    };

const AFTER_TEST_BRIEF =
  "The Project's Test failed after The Office merged the base branch into the Task's branch. Fix what the merge left broken, as the failure below shows, keeping what both sides meant. Don't run git: The Office commits your changes.";

/**
 * The git of a Resolve Stage around its Agent (spec §2.3, "Conflicts at Publish"; §5.5): The
 * Office merges the base in and leaves the conflicted files for the Agent, then commits the merge
 * once no conflict marker is left. A merge that can't be committed stays in progress, for the
 * Agent's next round or for the user, whom the walk asks.
 */
@Injectable()
export class ResolveStageGit {
  constructor(
    private readonly publishing: TaskPublishing,
    private readonly stageGit: StageGit,
  ) {}

  async begin(
    { run, earlierRuns }: StageWork<"agent">,
    task: TaskRecord,
    expected: ExpectedHead,
  ): Promise<ResolveBegun> {
    if (resolvedByTheUser(earlierRuns)) {
      const outcome = await this.finish(run, task, expected, {
        status: "done",
        summary: "Committed the merge of the base branch as the user resolved it in the worktree.",
      });
      return { kind: "ended", outcome };
    }
    if (afterResolveTestFailed(run.carriedFailure)) {
      return { kind: "agent", brief: AFTER_TEST_BRIEF, merging: false };
    }
    const start = await this.publishing.startResolve(task.project.id, run.taskId);
    switch (start.kind) {
      case "failed":
        return { kind: "ended", outcome: { status: "failed", error: start.error } };
      case "merged":
        await this.stageGit.leaveAt(run, { ...expected, commit: start.commit });
        return {
          kind: "ended",
          outcome: {
            status: "done",
            summary: `Merged ${start.base.branch} from ${start.base.remote} into the Task's branch with no conflict left to resolve.`,
          },
        };
      case "conflicted": {
        const files = start.conflictedFiles.map((file) => `- ${file}`).join("\n");
        if (conflictCameBackTooOften(run.carriedFailure)) {
          return {
            kind: "ended",
            outcome: {
              status: "failed",
              error: `The conflict at Publish came back after Resolve too often, so The Office leaves it to you. The conflicted files:\n${files}`,
            },
          };
        }
        return {
          kind: "agent",
          brief: resolveBrief(start.base.branch, start.conflictedFiles),
          merging: true,
        };
      }
    }
  }

  /**
   * After the Agent's done result, commits the merge as one merge commit and records where the
   * branch is now; refused while a conflict marker is left. Any other result leaves the merge in
   * progress.
   */
  async finish(
    run: StageRun,
    task: TaskRecord,
    expected: ExpectedHead,
    result: StageOutcome,
  ): Promise<StageOutcome> {
    if (result.status !== "done") {
      await this.stageGit.leaveAt(run, expected);
      return result;
    }
    const end = await this.publishing.finishResolve(task.project.id, run.taskId);
    if (end.kind === "resolved") {
      await this.stageGit.leaveAt(run, { ...expected, commit: end.commit });
      return result;
    }
    await this.stageGit.leaveAt(run, expected);
    const error =
      end.kind === "markers-left"
        ? `These files still hold conflict markers, so The Office didn't commit the merge:\n${end.files.map((file) => `- ${file}`).join("\n")}`
        : end.error;
    return {
      status: "failed",
      error,
      ...(result.handoverNote !== undefined && { handoverNote: result.handoverNote }),
    };
  }
}
