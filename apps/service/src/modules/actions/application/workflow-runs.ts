import { Injectable, Logger } from "@nestjs/common";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import {
  failedRun,
  isRunning,
  WORKFLOW_FOLLOW_POLL_MS,
  WORKFLOW_SHOW_MS,
  WORKFLOW_SHOW_POLL_MS,
  workflowAsked,
  workflowFollowed,
  type ActionRun,
} from "../domain/action-run.js";
import { ActionRunRefused } from "../domain/action-run-refused.js";
import { didNotShow } from "../domain/action-run-words.js";
import { ActionRunRepository } from "../ports/action-run-repository.js";
import { ActionWorkflowHost, type HostCiRun } from "../ports/action-workflow-host.js";
import { ActionRunLogs } from "./action-run-logs.js";
import { ActionRunRecords } from "./action-run-records.js";
import { RunsInBackground } from "./runs-in-background.js";

/** The code host's name when the start that told it is forgotten, as after a restart. */
const SOME_CODE_HOST = "The code host";

/**
 * A Workflow run (spec §2.15, "States"): its start on the code host with The Office's sign-in and
 * the Action's fixed inputs, in the background; Starting until its CI run shows, asked every few
 * seconds, Failed when none shows within 60 seconds; then its CI run's status, read until it ends.
 * Its log: the start, its inputs and the CI run's link. The Office never cancels it.
 */
@Injectable()
export class WorkflowRuns {
  private readonly logger = new Logger(WorkflowRuns.name);
  /** Each run's next look at the code host. */
  private readonly waits = new Map<string, Wait>();
  /** The code host's name and the Workflow's runs page each start was taken by. */
  private readonly hostNames = new Map<string, string>();
  private readonly runsUrls = new Map<string, string>();

  constructor(
    private readonly host: ActionWorkflowHost,
    private readonly repository: ActionRunRepository,
    private readonly records: ActionRunRecords,
    private readonly logs: ActionRunLogs,
    private readonly schedule: Schedule,
    private readonly background: RunsInBackground,
  ) {}

  /** Starts it in the background; the row is Starting already. */
  begin(run: ActionRun, inputs: Readonly<Record<string, string>>): void {
    this.background.start(`The Workflow run ${run.id} didn't start.`, () =>
      this.started(run, inputs),
    );
  }

  /** Follows a run left Starting or running, as The Office starts again. */
  resume(run: ActionRun): void {
    if (run.status.kind !== "workflow" || !isRunning(run)) return;
    if (run.ciRun === undefined) this.lookAgainLater(run.id, "show");
    else this.lookAgainLater(run.id, "follow");
  }

  /** Stops looking at the code host for every run, as the module stops. */
  forgetAll(): void {
    for (const wait of this.waits.values()) wait.cancel();
    this.waits.clear();
  }

  private async started(run: ActionRun, inputs: Readonly<Record<string, string>>): Promise<void> {
    const file = run.workflowFile ?? "";
    await this.logs.note(run.id, `Starting the Workflow ${file} on ${run.branch}.`);
    const named = Object.entries(inputs);
    await this.logs.note(
      run.id,
      named.length === 0
        ? "Its inputs: none; the Workflow's defaults apply."
        : `Its inputs: ${named.map(([name, value]) => `${name}=${value}`).join(", ")}.`,
    );
    let asked: Awaited<ReturnType<ActionWorkflowHost["start"]>>;
    try {
      asked = await this.host.start(run.projectId, file, run.branch, inputs);
    } catch (error) {
      if (!(error instanceof ActionRunRefused)) throw error;
      await this.fail(run.id, error.message, undefined);
      return;
    }
    this.hostNames.set(run.id, asked.hostName);
    if (asked.runsUrl !== undefined) this.runsUrls.set(run.id, asked.runsUrl);
    await this.records.change(run.id, (kept) => workflowAsked(kept, asked.askedAt));
    await this.logs.note(run.id, `${asked.hostName} took the start; waiting for its run to show.`);
    this.lookAgainLater(run.id, "show");
  }

  private lookAgainLater(runId: string, look: "show" | "follow"): void {
    this.waits.get(runId)?.cancel();
    const at = new Date(
      this.schedule.now().getTime() +
        (look === "show" ? WORKFLOW_SHOW_POLL_MS : WORKFLOW_FOLLOW_POLL_MS),
    );
    this.waits.set(
      runId,
      this.schedule.once(`action-run-${look}-${runId}`, at, () =>
        (look === "show" ? this.lookForTheRun(runId) : this.follow(runId)).catch(
          (error: unknown) => {
            this.logger.error(`Following the Workflow run ${runId} failed.`, error);
            this.lookAgainLater(runId, look);
          },
        ),
      ),
    );
  }

  private async lookForTheRun(runId: string): Promise<void> {
    this.waits.delete(runId);
    const run = await this.repository.find(runId);
    if (run === undefined || !isRunning(run) || run.ciRun !== undefined) return;
    const askedAt = run.askedAt ?? run.startedAt;
    let found: HostCiRun | undefined;
    try {
      const shown = await this.host.runsStartedByHand(
        run.projectId,
        run.workflowFile ?? "",
        run.branch,
        askedAt,
      );
      // Another Action of the same Workflow, or this one's last run, may have started just before.
      const held = await this.ciRunsHeldBesides(run);
      found = shown.find(({ id }) => !held.has(id));
    } catch (error) {
      if (!(error instanceof ActionRunRefused)) throw error;
      found = undefined;
    }
    if (found !== undefined) {
      await this.logs.note(runId, `Its run: ${found.workflowName} #${found.number}, ${found.url}`);
      await this.followed(run.id, found);
      return;
    }
    if (this.schedule.now().getTime() - askedAt.getTime() >= WORKFLOW_SHOW_MS) {
      await this.fail(
        runId,
        didNotShow(this.hostNames.get(runId) ?? SOME_CODE_HOST),
        this.runsUrls.get(runId),
      );
      return;
    }
    this.lookAgainLater(runId, "show");
  }

  /** The CI runs the Project's other Action runs follow already. */
  private async ciRunsHeldBesides(run: ActionRun): Promise<ReadonlySet<number>> {
    const runs = await this.repository.listOfProject(run.projectId);
    return new Set(
      runs.flatMap((each) => (each.id !== run.id && each.ciRun ? [each.ciRun.id] : [])),
    );
  }

  private async follow(runId: string): Promise<void> {
    this.waits.delete(runId);
    const run = await this.repository.find(runId);
    if (run === undefined || !isRunning(run) || run.ciRun === undefined) return;
    const now = await this.host.ciRunOf(run.projectId, run.ciRun.id);
    if (now === undefined) {
      this.lookAgainLater(runId, "follow");
      return;
    }
    await this.followed(runId, now);
  }

  private async followed(runId: string, ciRun: HostCiRun): Promise<void> {
    const at = this.schedule.now();
    const changed = await this.records.change(runId, (kept) => workflowFollowed(kept, ciRun, at));
    const run = changed ?? (await this.repository.find(runId));
    if (run !== undefined && isRunning(run)) this.lookAgainLater(runId, "follow");
    else this.forget(runId);
  }

  private async fail(runId: string, because: string, runsUrl: string | undefined): Promise<void> {
    const at = this.schedule.now();
    await this.logs.note(runId, `Failed: ${because}`);
    await this.records.change(runId, (kept) =>
      failedRun(kept, because, at, runsUrl === undefined ? {} : { workflowRunsUrl: runsUrl }),
    );
    this.forget(runId);
  }

  private forget(runId: string): void {
    this.hostNames.delete(runId);
    this.runsUrls.delete(runId);
  }
}
