import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { PromptTemplates } from "../../prompt-templates/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { baseWords } from "../domain/base-words.js";
import {
  afterResolveTestFailed,
  conflictCameBackTooOften,
  RESOLVE_BRIEF,
  RESOLVE_KEY,
  resolveBrief,
  resolvedByTheUser,
} from "../domain/resolve-stages.js";
import type { ExpectedHead } from "../domain/stage-commit.js";
import type { StageOutcome, StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskPublishing } from "../ports/task-publishing.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
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

const AFTER_GATE_BRIEF =
  "The user reviewed how the conflict with the base branch was resolved and sent it back. The merge is committed already: change what their feedback below asks, keeping what both sides meant. Don't run git: The Office commits your changes.";

/**
 * The git of a Resolve Stage around its Agent (spec §2.3, "Conflicts at Publish"; §5.5): The
 * Office merges the base in and leaves the conflicted files for the Agent, then commits the merge
 * once no conflict marker is left. A merge that can't be committed stays in progress, for the
 * Agent's next round or for the user, whom the walk asks; dropping the Task gives it back.
 */
@Injectable()
export class ResolveStageGit implements OnModuleInit {
  private readonly logger = new Logger(ResolveStageGit.name);

  constructor(
    private readonly publishing: TaskPublishing,
    private readonly git: TaskGit,
    private readonly stageGit: StageGit,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly events: EventBus,
    private readonly promptTemplates: PromptTemplates,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to === "dropped") await this.abandonMerge(taskId);
    });
  }

  /**
   * Gives a dropped Task's worktree back from a merge Resolve or an Agent's branch update left in
   * progress, so its branch stays as its last commit left it. A Task nothing ran on is left alone.
   */
  private async abandonMerge(taskId: string): Promise<void> {
    const runs = await this.runs.list(taskId);
    if (runs.length === 0) return;
    try {
      const task = await this.records.read(taskId);
      const resolved = runs.some(({ stageKey }) => stageKey === RESOLVE_KEY);
      if (!resolved && !(await this.git.mergeInProgress(task.project.id, taskId))) return;
      await this.publishing.abandonResolve(task.project.id, taskId);
    } catch (error) {
      // The Drop stands all the same; the merge is left in the worktree for the user to see.
      this.logger.warn(`Resolve's merge stays in Task ${taskId}'s worktree: ${String(error)}`);
    }
  }

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
    // The merge is committed already: the Gate's feedback is an ordinary round on the merged branch.
    if (run.sentBack) return { kind: "agent", brief: AFTER_GATE_BRIEF, merging: false };
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
            summary: `Merged ${task.initiativeBranch === undefined ? `${start.base.branch} from ${start.base.remote}` : baseWords(task)} into the Task's branch with no conflict left to resolve.`,
          },
        };
      case "conflicted": {
        // A clean merge of the Initiative's branch before the conflict with the base moved HEAD.
        if (start.commit !== undefined) {
          await this.stageGit.leaveAt(run, { ...expected, commit: start.commit });
        }
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
        const prompts = await this.promptTemplates.textsOf([RESOLVE_BRIEF]);
        return {
          kind: "agent",
          brief: resolveBrief(prompts, start.base.branch, start.conflictedFiles),
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
      await this.stageGit.leaveAtCommit(run, task, end.commit);
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
