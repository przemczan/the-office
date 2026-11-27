import { Controller, Get, Param, ParseUUIDPipe, Query, UseFilters } from "@nestjs/common";
import {
  type EntryPoint,
  type InitiativeTestInstances,
  type ProjectTestInstances as ProjectTestInstancesResponse,
  type TestInstanceLog,
} from "@the-office/contracts";
import { z } from "zod";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import {
  TestInstances,
  type InitiativeTestProject,
  type LaunchableTarget,
  type ProjectTestInstances,
} from "../../application/test-instances.js";
import type { TargetEntryPoint } from "../../domain/entry-point.js";
import { instanceResponse } from "./test-instance-responses.js";
import { TestInstanceRefusalsFilter } from "./test-instance-refusals.filter.js";

const logQuerySchema = z.object({ from: z.coerce.number().int().min(0).default(0) });
type LogQuery = z.infer<typeof logQuerySchema>;

/**
 * The Test instances of the Initiative page and the Project page (spec §2.12): list and log; launching
 * and stopping are Office actions (`TestInstanceOfficeActionsController`).
 */
@Controller()
@UseFilters(TestInstanceRefusalsFilter)
export class TestInstancesController {
  constructor(private readonly instances: TestInstances) {}

  @Get("initiatives/:id/test-instances")
  async list(@Param("id", ParseUUIDPipe) id: string): Promise<InitiativeTestInstances> {
    return { projects: (await this.instances.listFor(id)).map(projectResponse) };
  }

  @Get("projects/:id/test-instances")
  async listOfProject(@Param("id") id: string): Promise<ProjectTestInstancesResponse> {
    return projectInstancesResponse(await this.instances.listForProject(id));
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
  const { installs } = target;
  return {
    key: target.key,
    name: target.name,
    kind: target.kind,
    entryPoint: target.entryPoint === undefined ? null : entryPointResponse(target.entryPoint),
    installs:
      installs === undefined
        ? null
        : {
            buildTargetKey: installs.buildTargetKey,
            buildTargetName: installs.buildTargetName ?? null,
            projectDeviceId: installs.projectDeviceId,
            device: installs.device === undefined ? null : { ...installs.device },
          },
  };
}

function entryPointResponse(entryPoint: TargetEntryPoint): EntryPoint {
  return entryPoint.kind === "devcontainer-service"
    ? { ...entryPoint }
    : { ...entryPoint, arguments: [...entryPoint.arguments] };
}
