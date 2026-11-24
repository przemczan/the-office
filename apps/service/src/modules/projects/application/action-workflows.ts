import { Injectable } from "@nestjs/common";
import { workflowFileName } from "../domain/action.js";
import type { CiRunStatus } from "../domain/ci-run.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { Project } from "../domain/project.js";
import { CodeHostRefused, type CiRunOnHost, type CodeHost } from "../ports/code-host.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { CiRunWatch } from "./ci-run-watch.js";
import { WorkflowStarts } from "./workflow-starts.js";

/** A Workflow Action's start, as the code host took it. */
export interface ActionWorkflowStart {
  /** The Workflow's file name, as the code host knows it. */
  readonly workflowId: string;
  /** The Workflow's name, such as "Release". */
  readonly workflowName: string;
  /** The code host's name in the user's words, such as GitHub. */
  readonly hostName: string;
  /** When The Office asked the host, just before it did: its CI run is made after it. */
  readonly askedAt: Date;
  /** The Workflow's runs on the code host; undefined when the host can't say. */
  readonly runsUrl: string | undefined;
}

/** A Workflow run's CI run as the code host reports it now. */
export interface ActionCiRun {
  readonly id: number;
  readonly number: number;
  /** The Workflow's name, as "<workflow> #<number>" reads. */
  readonly workflowName: string;
  readonly url: string;
  /** The commit it runs. */
  readonly commit: string;
  readonly status: CiRunStatus;
}

/**
 * How to allow for the code host's clock and its whole seconds when finding the CI run a start
 * made: a run created this long before The Office asked still counts.
 */
const CLOCK_LEEWAY_MS = 5_000;

/**
 * A Workflow Action's run on the code host (spec §2.15, "States"): its start, with The Office's own
 * sign-in and the Action's fixed inputs, which the guard on Leaves the workstation Workflows never
 * refuses, as the Action is that guard; finding its CI run, the first run of that Workflow on that
 * branch started by hand by The Office's sign-in after the start was asked; and following it.
 * Every refusal of the host is a ProjectRefused in its words.
 */
@Injectable()
export class ActionWorkflows {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly ciRuns: CiRunWatch,
    private readonly starts: WorkflowStarts,
  ) {}

  /**
   * Starts Workflow `file` on `branch` with `inputs`, defaults filling the rest. Refused when the
   * Project's base branch tracks no remote on a code host The Office knows, when the file declares
   * no start by hand on the branch, or in the host's words when it refuses.
   */
  async start(
    projectId: string,
    file: string,
    branch: string,
    inputs: Readonly<Record<string, string>>,
  ): Promise<ActionWorkflowStart> {
    const { project, workflow, askedAt } = await this.starts.forAction(
      projectId,
      file,
      branch,
      inputs,
    );
    const { remoteUrl, host } = await this.hostOf(project);
    return {
      workflowId: workflow.id,
      workflowName: workflow.name,
      hostName: host.name,
      askedAt,
      runsUrl: host.workflowRunsUrl(remoteUrl, workflow.id),
    };
  }

  /**
   * The runs of Workflow `file` on `branch` started by hand by The Office's sign-in and made after
   * `askedAt`, oldest first; none while the code host shows none.
   */
  async runsStartedByHand(
    projectId: string,
    file: string,
    branch: string,
    askedAt: Date,
  ): Promise<readonly ActionCiRun[]> {
    const { remoteUrl, host } = await this.hostOf(await this.found(projectId));
    const runs = await refusing(
      host.runsStartedByHand(remoteUrl, {
        workflowId: workflowFileName(file),
        branch,
        createdSince: new Date(askedAt.getTime() - CLOCK_LEEWAY_MS),
      }),
    );
    return runs.map(actionCiRunOf);
  }

  /** CI run `runId` as the code host reports it now; undefined when it has no such run. */
  async ciRunOf(projectId: string, runId: number): Promise<ActionCiRun | undefined> {
    const { remoteUrl, host } = await this.hostOf(await this.found(projectId));
    const run = await refusing(host.ciRun(remoteUrl, runId));
    return run && actionCiRunOf(run);
  }

  /** The page of Workflow `file`'s runs on the code host; undefined when it can't be told. */
  async runsUrlOf(projectId: string, file: string): Promise<string | undefined> {
    const project = await this.found(projectId);
    const onHost = await this.ciRuns.onHost(project);
    return onHost?.host.workflowRunsUrl(onHost.remoteUrl, workflowFileName(file));
  }

  private async hostOf(project: Project): Promise<{ remoteUrl: string; host: CodeHost }> {
    const onHost = await this.ciRuns.onHost(project);
    if (onHost === undefined) {
      throw new ProjectRefused([
        `"${project.name}" has no Workflow to follow: its base branch tracks no remote on a code host The Office knows.`,
      ]);
    }
    return onHost;
  }

  private async found(projectId: string): Promise<Project> {
    const project = await this.projects.find(projectId);
    if (project === undefined) throw new ProjectNotFound(projectId);
    return project;
  }
}

function actionCiRunOf(run: CiRunOnHost): ActionCiRun {
  return {
    id: run.id,
    number: run.number,
    workflowName: run.workflow,
    url: run.url,
    commit: run.commit,
    status: run.status,
  };
}

async function refusing<Answer>(asked: Promise<Answer>): Promise<Answer> {
  try {
    return await asked;
  } catch (error) {
    if (error instanceof CodeHostRefused) throw new ProjectRefused([error.message]);
    throw error;
  }
}
