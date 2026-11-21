import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  projectTestInstanceLaunchSchema,
  testInstanceLaunchSchema,
  type EntryPoint,
  type InitiativeTestInstances,
  type ProjectTestInstanceLaunch,
  type ProjectTestInstances as ProjectTestInstancesResponse,
  type TestInstance as TestInstanceResponse,
  type TestInstanceLaunch,
  type TestInstanceLog,
} from "@the-office/contracts";
import { z } from "zod";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import {
  TestInstances,
  type InitiativeTestProject,
  type LaunchableTarget,
  type ProjectTestInstances,
  type TestInstanceOnBranch,
} from "../../application/test-instances.js";
import type { TargetEntryPoint } from "../../domain/entry-point.js";
import { TestInstanceRefusalsFilter } from "./test-instance-refusals.filter.js";

const logQuerySchema = z.object({ from: z.coerce.number().int().min(0).default(0) });
type LogQuery = z.infer<typeof logQuerySchema>;

/**
 * The Test instances of the Initiative page and the Project page (spec §2.12): list, launch, stop
 * and log.
 */
@Controller()
@UseFilters(TestInstanceRefusalsFilter)
export class TestInstancesController {
  constructor(private readonly instances: TestInstances) {}

  @Get("initiatives/:id/test-instances")
  async list(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeTestInstances> {
    return { projects: (await this.instances.listFor(id)).map(projectResponse) };
  }

  @Post("initiatives/:id/test-instances")
  async launch(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(testInstanceLaunchSchema)) launch: TestInstanceLaunch,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TestInstanceResponse> {
    const instance = await this.instances.launchOnInitiative(id, launch, {
      kind: "user",
      user: userOf(signedIn),
    });
    return instanceResponse(instance);
  }

  @Get("projects/:id/test-instances")
  async listOfProject(@Param("id") id: string): Promise<ProjectTestInstancesResponse> {
    return projectInstancesResponse(await this.instances.listForProject(id));
  }

  @Post("projects/:id/test-instances")
  async launchOnBranch(
    @Param("id") id: string,
    @Body(new ContractPipe(projectTestInstanceLaunchSchema)) launch: ProjectTestInstanceLaunch,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TestInstanceResponse> {
    const instance = await this.instances.launchOnBranch(id, launch.branch, launch.targetKey, {
      kind: "user",
      user: userOf(signedIn),
    });
    return instanceResponse(instance);
  }

  @Post("test-instances/:id/stop")
  @HttpCode(200)
  async stop(@Param("id", ParseUUIDPipe) id: string): Promise<TestInstanceResponse> {
    return instanceResponse(await this.instances.stop(id));
  }

  @Get("test-instances/:id/log")
  log(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ContractPipe(logQuerySchema)) { from }: LogQuery,
  ): Promise<TestInstanceLog> {
    return this.instances.readLog(id, from);
  }
}

function projectResponse(
  project: InitiativeTestProject,
): InitiativeTestInstances["projects"][number] {
  return {
    projectId: project.projectId,
    runEnvironmentOn: project.runEnvironmentOn,
    branchCommit: project.branchCommit ?? null,
    targets: project.targets.map((target) => ({
      ...targetResponse(target),
      instances: target.instances.map(instanceResponse),
    })),
  };
}

function projectInstancesResponse(project: ProjectTestInstances): ProjectTestInstancesResponse {
  return {
    runEnvironmentOn: project.runEnvironmentOn,
    targets: project.targets.map(targetResponse),
    branches: project.branches.map((branch) => ({
      name: branch.name,
      branchCommit: branch.branchCommit ?? null,
      instances: branch.instances.map(instanceResponse),
    })),
    initiatives: project.initiatives.map(({ id, name }) => ({ id, name })),
  };
}

function targetResponse(target: LaunchableTarget): ProjectTestInstancesResponse["targets"][number] {
  return {
    key: target.key,
    name: target.name,
    kind: target.kind,
    entryPoint: entryPointResponse(target.entryPoint),
  };
}

export function instanceResponse(instance: TestInstanceOnBranch): TestInstanceResponse {
  return {
    id: instance.id,
    initiativeId: instance.initiativeId ?? null,
    projectId: instance.projectId,
    branch: instance.branch,
    targetKey: instance.targetKey,
    targetName: instance.targetName,
    kind: instance.kind,
    state: instance.state,
    commit: instance.commit ?? null,
    port: instance.port ?? null,
    failedReason: instance.failedReason ?? null,
    launchedBy: instance.launchedBy,
    launchedAt: instance.launchedAt.toISOString(),
    runningAt: instance.runningAt?.toISOString() ?? null,
    endedAt: instance.endedAt?.toISOString() ?? null,
    files: instance.files.map(({ name, size }) => ({ name, size })),
    filesRemoved: instance.filesRemovedAt !== undefined,
  };
}

function entryPointResponse(entryPoint: TargetEntryPoint): EntryPoint {
  return entryPoint.kind === "devcontainer-service"
    ? { ...entryPoint }
    : { ...entryPoint, arguments: [...entryPoint.arguments] };
}
