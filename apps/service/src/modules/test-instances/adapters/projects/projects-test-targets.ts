import { Injectable } from "@nestjs/common";
import {
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  TestInstanceCheckouts,
  TestTargets,
} from "../../../projects/index.js";
import { TestInstanceNotFound, TestInstanceRefused } from "../../domain/test-instance-refused.js";
import {
  ProjectTestTargets,
  type InstallSettings,
  type ListedTarget,
  type TargetLaunch,
  type WorkstationBuild,
  type WorkstationBuildEnd,
} from "../../ports/project-test-targets.js";

/**
 * Projects' test targets and checkouts, through its public interface; its refusals come out as
 * this module's, in the same words.
 */
@Injectable()
export class ProjectsTestTargets extends ProjectTestTargets {
  constructor(
    private readonly projects: ProjectService,
    private readonly testTargets: TestTargets,
    private readonly checkouts: TestInstanceCheckouts,
  ) {
    super();
  }

  targetsOf(projectId: string): Promise<readonly ListedTarget[]> {
    return translated(async () =>
      (await this.testTargets.list(projectId)).map(({ key, name, kind, entryPoint }) => ({
        key,
        name,
        kind,
        entryPoint,
      })),
    );
  }

  runEnvironmentOn(projectId: string): Promise<boolean> {
    return translated(async () => (await this.projects.read(projectId)).runEnvironment === "on");
  }

  launchOf(projectId: string, key: string): Promise<TargetLaunch> {
    return translated(async () => {
      const launch = await this.testTargets.launchSettingsOf(projectId, key);
      const { target } = launch;
      return {
        key: target.key,
        name: target.name,
        kind: target.kind,
        entryPoint: target.entryPoint,
        containerPort: target.kind === "build-to-install" ? undefined : target.port,
        outputPatterns: target.kind === "build-to-install" ? target.outputPatterns : [],
        runEnvironmentOn: launch.runEnvironmentOn,
        variables: launch.variables.map(({ name, value, secret }) => ({ name, value, secret })),
        secretsWithoutValue: launch.secretsWithoutValue,
        mask: launch.mask,
      };
    });
  }

  entryPointProblemsAt(projectId: string, commit: string, key: string): Promise<string[]> {
    return translated(() => this.testTargets.entryPointProblemsAt(projectId, commit, key));
  }

  checkOut(projectId: string, branch: string, folder: string): Promise<{ commit: string }> {
    return translated(() => this.checkouts.checkOut(projectId, branch, folder));
  }

  branchCommitOf(projectId: string, branch: string): Promise<string | undefined> {
    return translated(() => this.checkouts.branchCommitOf(projectId, branch));
  }

  removeCheckout(folder: string): Promise<void> {
    return this.checkouts.remove(folder);
  }

  installSettingsOf(projectId: string): Promise<InstallSettings> {
    return translated(() => this.checkouts.installSettingsOf(projectId));
  }

  runBuild(build: WorkstationBuild): Promise<WorkstationBuildEnd> {
    return translated(async () => {
      const { outcome, exitCode } = await this.checkouts.runBuild(build);
      switch (outcome) {
        case "timed-out":
          return { exitCode: undefined, endedBy: "timeout" };
        case "stopped":
          return { exitCode: undefined, endedBy: "stop" };
        case "could-not-run":
          return { exitCode, endedBy: "could-not-run" };
        default:
          return { exitCode, endedBy: undefined };
      }
    });
  }
}

async function translated<Result>(step: () => Promise<Result>): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof ProjectRefused) throw new TestInstanceRefused(error.reasons);
    if (error instanceof ProjectNotFound) throw new TestInstanceNotFound(error.message);
    throw error;
  }
}
