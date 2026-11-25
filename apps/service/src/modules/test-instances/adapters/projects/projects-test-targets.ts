import { Injectable } from "@nestjs/common";
import { DEFAULT_PORT_VARIABLE } from "@the-office/contracts";
import {
  OutputMask,
  ProjectFeatures,
  ProjectNotFound,
  ProjectRefused,
  ProjectService,
  TestInstanceCheckouts,
  TestTargets,
  type RunTargetLaunchSettings,
} from "../../../projects/index.js";
import { TestInstanceNotFound, TestInstanceRefused } from "../../domain/test-instance-refused.js";
import {
  ProjectTestTargets,
  type InstallLaunch,
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
    private readonly features: ProjectFeatures,
  ) {
    super();
  }

  targetsOf(projectId: string): Promise<readonly ListedTarget[]> {
    return translated(async () => {
      const targets = await this.testTargets.list(projectId);
      return targets.map((target) =>
        "entryPoint" in target
          ? {
              key: target.key,
              name: target.name,
              kind: target.kind,
              entryPoint: target.entryPoint,
              installs: undefined,
            }
          : {
              key: target.key,
              name: target.name,
              kind: target.kind,
              entryPoint: undefined,
              installs: {
                buildTargetKey: target.buildTargetKey,
                buildTargetName: targets.find(
                  ({ key, kind }) => key === target.buildTargetKey && kind === "build-to-install",
                )?.name,
                projectDeviceId: target.projectDeviceId,
              },
            },
      );
    });
  }

  testTargetsOn(projectId: string): Promise<boolean> {
    return this.features.isOn(projectId, "test-targets");
  }

  runEnvironmentOn(projectId: string): Promise<boolean> {
    return translated(async () => (await this.projects.read(projectId)).runEnvironment === "on");
  }

  launchOf(projectId: string, key: string): Promise<TargetLaunch | InstallLaunch> {
    return translated(async () => {
      const launch = await this.testTargets.launchSettingsOf(projectId, key);
      if (launch.kind !== "install-on-a-device") return runLaunchOf(launch);
      const build = launch.build && runLaunchOf(launch.build);
      return {
        key: launch.target.key,
        name: launch.target.name,
        kind: launch.kind,
        runEnvironmentOn: launch.runEnvironmentOn,
        buildTargetKey: launch.buildTargetKey,
        projectDeviceId: launch.projectDeviceId,
        build,
        mask: build?.mask ?? OutputMask.NONE,
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

/** A Hosted or Build to install target's launch, from Projects' settings for it. */
function runLaunchOf(launch: RunTargetLaunchSettings): TargetLaunch {
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
    commandsBefore: launch.commandsBefore.map((command) => ({
      key: command.key,
      name: command.name,
      commandLine: command.commandLine,
    })),
    missingCommands: launch.missingCommands,
    portVariable:
      target.kind === "hosted" ? (launch.portVariable ?? DEFAULT_PORT_VARIABLE) : undefined,
    memoryMegabytes: launch.memoryMegabytes,
    mask: launch.mask,
  };
}
