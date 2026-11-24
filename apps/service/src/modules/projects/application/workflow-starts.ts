import { Injectable, Logger } from "@nestjs/common";
import { workflowFileName } from "../domain/action.js";
import { inputsToSend, type ManualWorkflow } from "../domain/manual-workflow.js";
import { isFeatureOn } from "../domain/project-features.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { Project } from "../domain/project.js";
import { ActionRepository } from "../ports/action-repository.js";
import { CodeHostRefused } from "../ports/code-host.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { CiRunWatch } from "./ci-run-watch.js";

/** A Workflow started by hand, as the start answers it. */
export interface WorkflowStarted {
  readonly project: Project;
  readonly workflow: ManualWorkflow;
  readonly ref: string;
  /** When The Office asked the code host, just before it did. */
  readonly askedAt: Date;
}

/**
 * Starting a Workflow by hand on a Project's code host (spec §2.1.6, "The CI tab"): by a user's
 * Start a workflow or an Agent's `start_workflow`, guarded by the Project's Actions, or by an
 * Action's run, which the guard is for. Either way its inputs are those its file declares at the
 * ref, defaults filling the rest, then the Project's runs are listed every round for a while, as
 * the host answers the start with no run.
 */
@Injectable()
export class WorkflowStarts {
  private readonly logger = new Logger(WorkflowStarts.name);

  constructor(
    private readonly projects: ProjectRepository,
    private readonly ciRuns: CiRunWatch,
    private readonly actions: ActionRepository,
  ) {}

  /**
   * A start by hand, a user's or an Agent's. While the Project's Actions are switched on, refuses,
   * whatever its inputs, a Workflow that an Action of the Project marked Leaves the workstation
   * starts, so neither goes around the Action's base branch and confirm step (spec §6, "Actions");
   * while they are off the guard is lifted.
   */
  async byHand(
    projectId: string,
    workflowId: string,
    ref: string,
    given: Readonly<Record<string, string>>,
  ): Promise<WorkflowStarted> {
    const project = await this.found(projectId);
    if (isFeatureOn(project, "actions")) {
      const guarding = (await this.actions.listOf(project.id)).find(
        (action) =>
          action.kind === "workflow" &&
          action.leavesTheWorkstation &&
          workflowFileName(action.settings.file) === workflowFileName(workflowId),
      );
      if (guarding !== undefined) {
        throw new ProjectRefused([
          `${workflowId} is started by the Action ${guarding.name}, from «${project.name}»'s Actions.`,
        ]);
      }
    }
    return this.started(project, workflowId, ref, given);
  }

  /** An Action's start of its Workflow: the guard is the Action's own, so it isn't asked. */
  async forAction(
    projectId: string,
    workflowId: string,
    branch: string,
    inputs: Readonly<Record<string, string>>,
  ): Promise<WorkflowStarted> {
    const project = await this.found(projectId);
    return this.started(project, workflowFileName(workflowId), branch, inputs);
  }

  private async started(
    project: Project,
    workflowId: string,
    ref: string,
    given: Readonly<Record<string, string>>,
  ): Promise<WorkflowStarted> {
    const onHost = await this.ciRuns.onHost(project);
    if (onHost === undefined) {
      throw new ProjectRefused([
        `"${project.name}" has no Workflow to start: its base branch tracks no remote on a code host The Office knows.`,
      ]);
    }
    const { remoteUrl, host } = onHost;
    try {
      const workflow = (await host.manualWorkflows(remoteUrl, ref)).find(
        (each) => each.id === workflowId,
      );
      if (workflow === undefined) {
        throw new ProjectRefused([
          `${workflowId} can't be started by hand on ${ref}: it has no workflow_dispatch there.`,
        ]);
      }
      const inputs = inputsToSend(workflow, given);
      const askedAt = new Date();
      await host.startWorkflow(remoteUrl, { workflowId: workflow.id, ref, inputs });
      // Its listing failing fails no start: the run goes all the same, and a later round lists it.
      await this.ciRuns.expectRun(project.id).catch((error: unknown) => {
        this.logger.warn(
          `Listing the CI runs of ${project.name} after a start by hand failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return { project, workflow, ref, askedAt };
    } catch (error) {
      if (error instanceof CodeHostRefused) throw new ProjectRefused([error.message]);
      throw error;
    }
  }

  private async found(projectId: string): Promise<Project> {
    const project = await this.projects.find(projectId);
    if (project === undefined) throw new ProjectNotFound(projectId);
    return project;
  }
}
