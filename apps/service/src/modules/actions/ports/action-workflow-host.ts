import type { CiRunState } from "../domain/action-run.js";

/** A Workflow run's CI run as the code host reports it now. */
export interface HostCiRun {
  readonly id: number;
  readonly number: number;
  readonly workflowName: string;
  readonly url: string;
  readonly commit: string;
  readonly status: CiRunState;
}

/**
 * Projects' code host for a Workflow run (spec §2.15, "Where a run runs"): its start, with The
 * Office's own sign-in, and its CI run. A refusal of the host is an ActionRunRefused in its words.
 */
export abstract class ActionWorkflowHost {
  abstract start(
    projectId: string,
    file: string,
    branch: string,
    inputs: Readonly<Record<string, string>>,
  ): Promise<{
    readonly hostName: string;
    readonly askedAt: Date;
    readonly runsUrl: string | undefined;
  }>;

  /**
   * The runs of the Workflow on the branch started by hand by The Office's sign-in since about
   * `askedAt`, oldest first: the start's is among them once the code host shows it.
   */
  abstract runsStartedByHand(
    projectId: string,
    file: string,
    branch: string,
    askedAt: Date,
  ): Promise<readonly HostCiRun[]>;

  abstract ciRunOf(projectId: string, runId: number): Promise<HostCiRun | undefined>;
}
