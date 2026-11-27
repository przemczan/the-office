import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import {
  afterPublishingFailedOutcome,
  continuedOutcome,
  publishedVariables,
  publishedMessage,
  publishOutcome,
  shippedOutcome,
  shippedWork,
  unfinishedPublication,
  type Publication,
} from "../domain/publish.js";
import { installFailure, scriptStageOutcome } from "../domain/script-stage-outcome.js";
import { stageCommitMessage, type ExpectedHead } from "../domain/stage-commit.js";
import {
  failedInstall,
  installRuns,
  type CommandRun,
  type StageCommandRunWithOutput,
} from "../domain/stage-command-run.js";
import { interruptedOutcome } from "../domain/stage-interruption.js";
import type { PublishedWork, StageOutcome } from "../domain/stage-run.js";
import { acceptedIssues } from "../domain/walk-decisions.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { TaskCommands, type PublishingLine } from "../ports/task-commands.js";
import { TaskGit } from "../ports/task-git.js";
import { TaskPublishing } from "../ports/task-publishing.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { TaskRecords, type TaskRecord } from "../ports/task-records.js";
import { TaskThreadSessions } from "../ports/task-thread-sessions.js";
import { InitiativeBranchStages } from "./initiative-branch-stages.js";
import { StageGit } from "./stage-git.js";
import { StageRunWaits } from "./stage-run-waits.js";
import { StageRunsFiles } from "./stage-runs-files.js";
import { BusyWork } from "../../busy-work/index.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/**
 * How a publishing line ended: passed, `ran` false for a blank line, which runs nothing; failed; or
 * stopped by The Office, with the Stage's outcome.
 */
type LineEnd =
  | { readonly kind: "passed"; readonly ran: boolean }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "stopped"; readonly outcome: StageOutcome };

/**
 * Runs Publish Stages (spec §2.3.4): The Office publishes with its own git rather than a Project
 * command, with no model call. It publishes the Task's committed branch by the Project's publishing
 * mode, landing the Task as one commit with its commit message or opening a pull request worded
 * from it, after which the message no longer changes, or pushes the branch only when the Stage's
 * target says so (a proof of concept); once it has published, the worktree goes; the branch keeps
 * the work for any Stage after it. Every run that ends carries its Publish result (`publishResult`),
 * which the routes test: a branch that conflicts with the base ends Conflict.
 *
 * Shipping by the publishing mode, as an ordinary Task or a Publishing Task does, it runs the
 * Project's before publishing line first, committing what it changed, and the after publishing
 * line once a pull request opened or a merge landed (spec §2.3 Defaults). What shipped is kept on
 * the run before the after line runs, so a run again after that line failed runs only the line.
 */
@Injectable()
export class PublishStage implements StageRunner<"publish">, OnModuleInit {
  private readonly logger = new Logger(PublishStage.name);

  constructor(
    private readonly runners: StageRunners,
    private readonly records: TaskRecords,
    private readonly publishing: TaskPublishing,
    private readonly git: TaskGit,
    private readonly stageGit: StageGit,
    private readonly threadSessions: TaskThreadSessions,
    private readonly branchStages: InitiativeBranchStages,
    private readonly commands: TaskCommands,
    private readonly runs: StageRunRepository,
    private readonly waits: StageRunWaits,
    private readonly tasks: StartedTasks,
    private readonly stageRunsFiles: StageRunsFiles,
    private readonly busyWork: BusyWork,
  ) {}

  onModuleInit(): void {
    this.runners.register("publish", this);
  }

  /** A Publish is busy work a scheduled Office update waits for. */
  async run(work: StageWork<"publish">): Promise<StageOutcome> {
    const outcome = await this.busyWork.during(
      { kind: "publish", label: `Publish in the Stage ${work.stage.name}` },
      () => this.publishWork(work),
    );
    return withPublishResult(outcome);
  }

  private async publishWork(work: StageWork<"publish">): Promise<StageOutcome> {
    const { stage, run, earlierRuns } = work;
    const task = await this.records.read(run.taskId);
    const { expected, refusal } = await this.stageGit.start(work, task);
    if (refusal) return refusal;
    if (!shipsByPublishingMode(work, task)) return this.publish(work, task, expected, []);
    const unfinished = unfinishedPublication(stage.key, earlierRuns);
    if (unfinished) {
      await this.stageGit.leaveAt(run, expected);
      if (unfinished.continued) return this.finish(task, run.taskId, continuedOutcome(unfinished));
      return this.afterPublishing(work, task, unfinished.published, []);
    }
    const before = await this.beforePublishing(work, task, expected);
    if ("outcome" in before) return before.outcome;
    return this.publish(work, task, before.expected, before.ran);
  }

  private async publish(
    work: StageWork<"publish">,
    task: TaskRecord,
    expected: ExpectedHead,
    ran: readonly StageCommandRunWithOutput[],
  ): Promise<StageOutcome> {
    const { stage, run } = work;
    const publish = () =>
      this.publishing.publish(
        task.project.id,
        run.taskId,
        publishedMessage(task.commitMessage.text),
        stage.publishTarget ?? "publishing-mode",
      );
    // A fix Task's Publish into the Initiative's branch waits for a running Publishing Task Stage,
    // whose own Publish holds the branch already as its Stage runs.
    const publication = task.publishingTask
      ? await publish()
      : await this.branchStages.holding(task, publish);
    const outcome = publishOutcome(publication);
    if (landedCommitMessage(publication)) await this.tasks.markCommitMessagePublished(run.taskId);
    // A merge may have merged a base into the branch, before a conflict with the next base too: the
    // next Stage expects HEAD where Publish left it.
    const left =
      publication.kind === "merged"
        ? publication.head
        : publication.kind === "base-moved"
          ? (publication.commit ?? expected.commit)
          : expected.commit;
    await this.stageGit.leaveAt(run, { ...expected, commit: left });
    if (outcome.status !== "done") return outcome;
    if (!shipsByPublishingMode(work, task)) return this.finish(task, run.taskId, outcome);
    const published = shippedWork(publication, left);
    if (published === undefined) {
      return this.finish(task, run.taskId, await this.nothingShipped(task, publication, outcome));
    }
    await this.runs.savePublished(run.id, published);
    return this.afterPublishing(work, task, published, ran, outcome.summary);
  }

  /**
   * Runs the before publishing line, committing what it changed, which is then what Publish
   * ships: HEAD is expected at that commit from here on. Its failure is the Stage's, as any
   * Script Stage's command's, with nothing published; what a failed line changed is committed
   * still, as a failed build-kind command's is, for the Stage it goes back to.
   */
  private async beforePublishing(
    work: StageWork<"publish">,
    task: TaskRecord,
    expected: ExpectedHead,
  ): Promise<
    | { readonly expected: ExpectedHead; readonly ran: readonly StageCommandRunWithOutput[] }
    | { readonly outcome: StageOutcome }
  > {
    const { run, stage } = work;
    const ran: StageCommandRunWithOutput[] = [];
    const end = await this.runLine(work, task, "beforePublishingCommand", {}, ran);
    if (end.kind === "stopped") {
      return { outcome: await this.stopped(work, task, expected, end.outcome) };
    }
    const lineRuns = ran.filter(({ purpose }) => purpose === "before-publishing");
    // A blank line, or an install that failed before it, changed nothing to commit.
    if (lineRuns.length === 0) {
      if (end.kind === "passed") return { expected, ran };
      await this.stageGit.leaveAt(run, expected);
      return { outcome: beforePublishingFailed(end.error) };
    }
    const moved = await this.stageGit.checkHead(run, task, expected);
    if (moved) {
      return {
        outcome: {
          status: "failed",
          error: `The before publishing line changed git itself: ${moved}. The Office stopped here without committing or publishing.`,
        },
      };
    }
    const message = stageCommitMessage(
      stage.name,
      task.title,
      scriptStageOutcome(lineRuns),
      acceptedIssues(work.stages, work.earlierRuns),
    );
    // A Publishing Task's branch failing to push now is no failure: its Publish pushes it again.
    await this.stageGit.commit(run, task, expected, message);
    if (end.kind === "failed") return { outcome: beforePublishingFailed(end.error) };
    const head = await this.git.head(task.project.id, run.taskId);
    return { expected: { ...expected, commit: head.commit }, ran };
  }

  /**
   * Runs the after publishing line once the work shipped, before the worktree goes. Its failure
   * keeps the worktree and ends the run with its own outcome, which the walk escalates.
   */
  private async afterPublishing(
    work: StageWork<"publish">,
    task: TaskRecord,
    published: PublishedWork,
    ranBefore: readonly StageCommandRunWithOutput[],
    shippedSummary?: string,
  ): Promise<StageOutcome> {
    const { run } = work;
    const ran = [...ranBefore];
    const end = await this.runLine(
      work,
      task,
      "afterPublishingCommand",
      publishedVariables(published),
      ran,
    );
    switch (end.kind) {
      case "stopped":
        return end.outcome;
      case "failed":
        return afterPublishingFailedOutcome(published, end.error);
      case "passed":
        return this.finish(
          task,
          run.taskId,
          shippedOutcome(published, { summary: shippedSummary, afterLineRan: end.ran }),
        );
    }
  }

  /**
   * Runs one of the Project's publishing lines after the install, where a Script Stage's command
   * runs, recording each run on the Stage run beside those in `ran`, which it adds to. A blank
   * line runs nothing and passes.
   */
  private async runLine(
    work: StageWork<"publish">,
    task: TaskRecord,
    line: PublishingLine,
    variables: Readonly<Record<string, string>>,
    ran: StageCommandRunWithOutput[],
  ): Promise<LineEnd> {
    const { run, interruption } = work;
    const lines = await this.commands.publishingLines(task.project.id);
    if (lines[line].trim() === "") return { kind: "passed", ran: false };
    const options = { signal: interruption.commandsSignal, wait: this.waits.of(run) };
    const installation = await this.commands.install(task.project.id, run.taskId, options);
    ran.push(...installRuns(installation));
    const failed = failedInstall(installation);
    if (failed?.outcome === "stopped") return this.lineStopped(work, ran);
    if (failed) {
      await this.runs.saveCommandRuns(run.id, ran);
      return { kind: "failed", error: `${installFailure(failed)}\n\nThe line didn't run.` };
    }
    const lineRun = await this.commands.runPublishingLine(
      task.project.id,
      run.taskId,
      line,
      variables,
      options,
    );
    if (lineRun === undefined) return { kind: "passed", ran: false };
    ran.push(recorded(lineRun, line));
    if (lineRun.outcome === "stopped") return this.lineStopped(work, ran);
    await this.runs.saveCommandRuns(run.id, ran);
    const outcome = scriptStageOutcome([lineRun]);
    return outcome.status === "failed"
      ? { kind: "failed", error: outcome.error }
      : { kind: "passed", ran: true };
  }

  private async lineStopped(
    { run, interruption }: StageWork<"publish">,
    ran: readonly StageCommandRunWithOutput[],
  ): Promise<LineEnd> {
    const stoppedBy = interruption.requested;
    if (!stoppedBy) {
      throw new Error(`Stage run ${run.id}'s publishing line stopped, yet nothing interrupted it.`);
    }
    await this.runs.saveCommandRuns(run.id, ran);
    return {
      kind: "stopped",
      outcome: interruptedOutcome(stoppedBy, [], { cutShortBy: interruption.cutShortBy }),
    };
  }

  /**
   * Ends a run whose before publishing line The Office stopped, nothing published: what the line
   * left uncommitted is kept after a shutdown and after the alarm, as for a Script Stage.
   */
  private async stopped(
    { run, interruption }: StageWork<"publish">,
    task: TaskRecord,
    expected: ExpectedHead,
    held: StageOutcome,
  ): Promise<StageOutcome> {
    const stoppedBy = interruption.requested;
    if (!stoppedBy || held.status !== "failed") return held;
    const moved = await this.stageGit.checkHead(run, task, expected);
    if (moved) {
      return {
        status: "failed",
        error: `The before publishing line changed git itself: ${moved}. The Office stopped here without committing.`,
      };
    }
    const discarded = await this.stageGit.settleInterrupted(run, task, expected, stoppedBy);
    return interruptedOutcome(stoppedBy, discarded, { cutShortBy: interruption.cutShortBy });
  }

  /** Nothing shipped, so the after publishing line doesn't run: the outcome says so when it is set. */
  private async nothingShipped(
    task: TaskRecord,
    publication: Publication,
    outcome: StageOutcome,
  ): Promise<StageOutcome> {
    if (publication.kind !== "nothing-to-publish" || outcome.status !== "done") return outcome;
    const lines = await this.commands.publishingLines(task.project.id);
    if (lines.afterPublishingCommand.trim() === "") return outcome;
    return {
      ...outcome,
      summary: `${outcome.summary} The after publishing line didn't run, as nothing shipped.`,
    };
  }

  /** The Stage is done: the worktree goes, and the outcome tells when it couldn't. */
  private async finish(
    task: TaskRecord,
    taskId: string,
    outcome: StageOutcome,
  ): Promise<StageOutcome> {
    if (outcome.status !== "done") return outcome;
    return {
      ...outcome,
      summary: `${outcome.summary}${await this.removeWorktree(task.project.id, taskId)}`,
    };
  }

  /**
   * Removes the worktree once no waiting session works in it, such as the Planner's; one that
   * stays, as a session still answering keeps it, is no failure of what was published, only told of.
   */
  private async removeWorktree(projectId: string, taskId: string): Promise<string> {
    try {
      await this.threadSessions.endWaiting(taskId);
      await this.git.removeWorktree(projectId, taskId);
      await this.stageRunsFiles.remove(taskId);
      return "";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Task ${taskId}'s worktree stays after Publish: ${reason}`);
      return `\n\nThe Office couldn't remove the Task's worktree, which stays: ${reason}`;
    }
  }
}

/**
 * Whether the Publish ships by the publishing mode, the only one the publishing lines run around:
 * an ordinary Task's or a Publishing Task's, never a fix Task's into its Initiative's branch nor the
 * proof of concept's branch-only push.
 */
function shipsByPublishingMode({ stage }: StageWork<"publish">, task: TaskRecord): boolean {
  const target = stage.publishTarget ?? "publishing-mode";
  return (
    target === "publishing-mode" &&
    (task.publishingTask === true || task.initiativeBranch === undefined)
  );
}

/**
 * Whether Publish landed the Task's commit message: as the one commit it landed the Task as, or as
 * the pull request it opened.
 */
function landedCommitMessage(publication: Publication): boolean {
  return (
    publication.kind === "pull-request-opened" ||
    (publication.kind === "merged" && publication.subject !== undefined)
  );
}

/**
 * `outcome` with its Publish result: a failure The Office found itself, such as the before
 * publishing line's or a branch moved outside it, is Failed, as `publishOutcome` already words what
 * the publication answered. A run The Office interrupted has none: it runs again.
 */
function withPublishResult(outcome: StageOutcome): StageOutcome {
  if (outcome.status !== "failed" || outcome.publishResult !== undefined) return outcome;
  if (outcome.interrupted !== undefined) return outcome;
  return { ...outcome, publishResult: "failed" };
}

function beforePublishingFailed(error: string): StageOutcome {
  return {
    status: "failed",
    error: `The before publishing line failed, so nothing was published: ${error}`,
  };
}

/** A publishing line's run as the Stage run records it. */
function recorded(run: CommandRun, line: PublishingLine): StageCommandRunWithOutput {
  return {
    ...run,
    purpose: line === "beforePublishingCommand" ? "before-publishing" : "after-publishing",
  };
}
