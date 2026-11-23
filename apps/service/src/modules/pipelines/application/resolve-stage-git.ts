import { Injectable, Logger } from "@nestjs/common";
import { PromptTemplates } from "../../prompt-templates/index.js";
import { baseWords } from "../domain/base-words.js";
import {
  broughtBackBy,
  MERGE_BASE_CLEAN,
  MERGE_BASE_FIRST_TEMPLATES,
  RESOLVE_AFTER_GATE,
  RESOLVE_AFTER_TEST,
  resolveBrief,
  resolvedByTheUser,
} from "../domain/merge-base-first.js";
import type { ExpectedHead } from "../domain/stage-commit.js";
import type { StageOutcome, StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskPublishing } from "../ports/task-publishing.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
import { StageGit } from "./stage-git.js";
import type { StageWork } from "./stage-runner.js";

/** How a Stage that merges the base first goes on before its Agent: ended already, or its turn. */
export type ResolveBegun =
  | { readonly kind: "ended"; readonly outcome: StageOutcome }
  | {
      readonly kind: "agent";
      /** What the Brief says of the merge, on top of the Stage's own brief. */
      readonly brief: string;
      /** Whether a merge is in progress, which The Office commits after the Agent. */
      readonly merging: boolean;
      /** Where the Agent's turn begins: after a clean merge, at its merge commit. */
      readonly expected: ExpectedHead;
    };

/**
 * The git of an Agent Stage with Merge the base first around its Agent (spec §2.3.1, "An Agent
 * Stage may merge the base first"; §5.5): The Office merges the base in as the Stage starts and
 * leaves the conflicted files for the Agent, then commits the merge once no conflict marker is
 * left; a clean merge is committed at once, and the Agent's turn runs all the same. A merge that
 * can't be committed stays in progress, for the Agent's next round or for the user, whom the walk
 * asks; dropping the Task gives it back. `finish` also commits a merge an Agent's own branch update
 * left, on any Stage.
 */
@Injectable()
export class ResolveStageGit {
  private readonly logger = new Logger(ResolveStageGit.name);

  constructor(
    private readonly publishing: TaskPublishing,
    private readonly git: TaskGit,
    private readonly stageGit: StageGit,
    private readonly runs: StageRunRepository,
    private readonly records: TaskRecords,
    private readonly promptTemplates: PromptTemplates,
  ) {}

  /**
   * Gives a dropped Task's worktree back from a merge a Stage or an Agent's branch update left in
   * progress, so its branch stays as its last commit left it. A Task nothing ran on is left alone.
   * `DroppedTaskWorktrees` calls it on the Drop, before it removes any worktree.
   */
  async abandonMerge(taskId: string): Promise<void> {
    const runs = await this.runs.list(taskId);
    if (runs.length === 0) return;
    try {
      const task = await this.records.read(taskId);
      if (!(await this.git.mergeInProgress(task.project.id, taskId))) return;
      await this.publishing.abandonResolve(task.project.id, taskId);
    } catch (error) {
      // The Drop stands all the same; the merge is left in the worktree for the user to see.
      this.logger.warn(`The merge stays in Task ${taskId}'s worktree: ${String(error)}`);
    }
  }

  /**
   * Merges the freshly fetched base into the Task's branch as the Stage starts. A run the walk
   * brought back after its merge was committed merges only what the base gained since, and is
   * briefed with why it came back; one whose previous run the user answered with "I resolved it in
   * the worktree" only commits the merge.
   */
  async begin(
    { stage, run, stages, earlierRuns }: StageWork<"agent">,
    task: TaskRecord,
    expected: ExpectedHead,
  ): Promise<ResolveBegun> {
    if (resolvedByTheUser(stage, earlierRuns)) {
      const outcome = await this.finish(run, task, expected, {
        status: "done",
        summary: "Committed the merge of the base branch as the user resolved it in the worktree.",
      });
      return { kind: "ended", outcome };
    }
    const prompts = await this.promptTemplates.textsOf(MERGE_BASE_FIRST_TEMPLATES);
    const broughtBack = broughtBackBy(run, stages);
    // The merge is committed already: the failure or the Gate's feedback is a round on the merged branch.
    const why =
      broughtBack === "script-failure"
        ? prompts.render(RESOLVE_AFTER_TEST, {})
        : broughtBack === "send-back"
          ? prompts.render(RESOLVE_AFTER_GATE, {})
          : undefined;
    const start = await this.publishing.startResolve(task.project.id, run.taskId);
    switch (start.kind) {
      case "failed":
        return { kind: "ended", outcome: { status: "failed", error: start.error } };
      case "merged": {
        const merged = { ...expected, commit: start.commit };
        await this.stageGit.leaveAt(run, merged);
        // Brought back with nothing new on the base, there is no merge to tell of.
        const cameIn =
          broughtBack === undefined || start.commit !== expected.commit
            ? prompts.render(MERGE_BASE_CLEAN, {
                baseBranch:
                  task.initiativeBranch === undefined ? start.base.branch : baseWords(task),
              })
            : undefined;
        return { kind: "agent", brief: sections(why, cameIn), merging: false, expected: merged };
      }
      case "conflicted": {
        // A clean merge of the Initiative's branch before the conflict with the base moved HEAD.
        const left = start.commit === undefined ? expected : { ...expected, commit: start.commit };
        if (start.commit !== undefined) await this.stageGit.leaveAt(run, left);
        return {
          kind: "agent",
          brief: sections(why, resolveBrief(prompts, start.base.branch, start.conflictedFiles)),
          merging: true,
          expected: left,
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

function sections(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined).join("\n\n");
}
