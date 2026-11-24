import { Injectable } from "@nestjs/common";
import { ActionWorkflows, type ActionCiRun } from "../../../projects/index.js";
import { ActionWorkflowHost, type HostCiRun } from "../../ports/action-workflow-host.js";
import { translated } from "./translated.js";

/** Projects' code host: a Workflow Action's start and its CI run. */
@Injectable()
export class ProjectsWorkflowHost extends ActionWorkflowHost {
  constructor(private readonly workflows: ActionWorkflows) {
    super();
  }

  start(
    projectId: string,
    file: string,
    branch: string,
    inputs: Readonly<Record<string, string>>,
  ): Promise<{ hostName: string; askedAt: Date; runsUrl: string | undefined }> {
    return translated(() => this.workflows.start(projectId, file, branch, inputs));
  }

  async runsStartedByHand(
    projectId: string,
    file: string,
    branch: string,
    askedAt: Date,
  ): Promise<readonly HostCiRun[]> {
    const runs = await translated(() =>
      this.workflows.runsStartedByHand(projectId, file, branch, askedAt),
    );
    return runs.map(hostCiRunOf);
  }

  async ciRunOf(projectId: string, runId: number): Promise<HostCiRun | undefined> {
    const run = await translated(() => this.workflows.ciRunOf(projectId, runId));
    return run && hostCiRunOf(run);
  }
}

function hostCiRunOf(run: ActionCiRun): HostCiRun {
  return { ...run };
}
