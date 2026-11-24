import { Injectable } from "@nestjs/common";
import {
  ActionRunCheckouts,
  ActionRunSettings,
  TestTargets,
  type Action,
} from "../../../projects/index.js";
import {
  ActionProjects,
  type CommandRunSettings,
  type RunAction,
  type RunProject,
  type WorkstationRunEnd,
} from "../../ports/action-projects.js";
import { translated } from "./translated.js";

/** Projects' Actions, their settings, the branches' tips and the runs' checkouts. */
@Injectable()
export class ProjectsActionProjects extends ActionProjects {
  constructor(
    private readonly settings: ActionRunSettings,
    private readonly checkouts: ActionRunCheckouts,
    private readonly targets: TestTargets,
  ) {
    super();
  }

  projectOf(projectId: string): Promise<RunProject> {
    return translated(() => this.settings.projectOf(projectId));
  }

  async actionsOf(projectId: string): Promise<readonly RunAction[]> {
    return (await translated(() => this.settings.actionsOf(projectId))).map(runActionOf);
  }

  async actionOf(projectId: string, key: string): Promise<RunAction | undefined> {
    const action = await translated(() => this.settings.actionOf(projectId, key));
    return action && runActionOf(action);
  }

  commandRunOf(projectId: string, key: string): Promise<CommandRunSettings> {
    return translated(() => this.settings.commandRunOf(projectId, key));
  }

  async hasTestTarget(projectId: string, key: string): Promise<boolean> {
    const targets = await translated(() => this.targets.list(projectId));
    return targets.some((target) => target.key === key);
  }

  branchTip(projectId: string, branch: string): Promise<{ commit: string; subject: string }> {
    return translated(() => this.checkouts.branchTip(projectId, branch));
  }

  remoteHasBranch(projectId: string, branch: string): Promise<boolean> {
    return translated(() => this.checkouts.remoteHasBranch(projectId, branch));
  }

  checkOut(projectId: string, runId: string, branch: string, commit: string): Promise<string> {
    return translated(() => this.checkouts.checkOut(projectId, runId, branch, commit));
  }

  removeCheckout(runId: string): Promise<void> {
    return this.checkouts.remove(runId);
  }

  logFileOf(runId: string): string {
    return this.checkouts.logFileOf(runId);
  }

  removeLog(runId: string): Promise<void> {
    return this.checkouts.removeLog(runId);
  }

  leftoverRunIds(): Promise<readonly string[]> {
    return this.checkouts.leftoverRunIds();
  }

  runOnWorkstation(
    run: Parameters<ActionProjects["runOnWorkstation"]>[0],
  ): Promise<WorkstationRunEnd> {
    return translated(() => this.checkouts.run(run));
  }
}

function runActionOf(action: Action): RunAction {
  const { key, name, leavesTheWorkstation } = action;
  switch (action.kind) {
    case "project-command":
      return { key, name, leavesTheWorkstation, kind: action.kind, settings: action.settings };
    case "test-target":
      return { key, name, leavesTheWorkstation, kind: action.kind, settings: action.settings };
    case "workflow":
      return { key, name, leavesTheWorkstation, kind: action.kind, settings: action.settings };
  }
}
