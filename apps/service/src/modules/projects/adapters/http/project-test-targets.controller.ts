import { Body, Controller, Get, Param, Put, UseFilters } from "@nestjs/common";
import {
  testTargetsEditSchema,
  type EntryPoint as EntryPointResponse,
  type TestTarget as TestTargetResponse,
  type TestTargetList,
  type TestTargetsEdit,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { TestTargets } from "../../application/test-targets.js";
import type { EntryPoint } from "../../domain/entry-point.js";
import {
  shownTestTargets,
  type ShownTestTarget,
  type TestTarget,
} from "../../domain/test-target.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/** The Project page's Test targets: saved whole, a Secret variable's value never sent back. */
@Controller("projects")
@UseFilters(ProjectRefusalsFilter)
export class ProjectTestTargetsController {
  constructor(private readonly testTargets: TestTargets) {}

  @Get(":id/test-targets")
  async list(@Param("id") id: string): Promise<TestTargetList> {
    return toResponse(await this.testTargets.list(id));
  }

  @Put(":id/test-targets")
  async change(
    @Param("id") id: string,
    @Body(new ContractPipe(testTargetsEditSchema)) { targets }: TestTargetsEdit,
    @SignedIn() signedIn: SignedIn,
  ): Promise<TestTargetList> {
    return toResponse(await this.testTargets.change(id, targets, userOf(signedIn)));
  }
}

function toResponse(targets: readonly TestTarget[]): TestTargetList {
  return { targets: shownTestTargets(targets).map(toTargetResponse) };
}

function toTargetResponse(target: ShownTestTarget): TestTargetResponse {
  const common = {
    key: target.key,
    name: target.name,
    entryPoint: toEntryPointResponse(target.entryPoint),
    variables: target.variables.map(({ name, value }) => ({ name, value })),
    secretVariables: target.secretVariables.map(({ name, valueSet }) => ({ name, valueSet })),
    commandsBefore: [...target.commandsBefore],
    memoryMegabytes: target.memoryMegabytes,
    setBy: { ...target.setBy },
  };
  return target.kind === "build-to-install"
    ? { ...common, kind: target.kind, outputPatterns: [...target.outputPatterns] }
    : { ...common, kind: target.kind, port: target.port, portVariable: target.portVariable };
}

function toEntryPointResponse(entryPoint: EntryPoint): EntryPointResponse {
  return entryPoint.kind === "devcontainer-service"
    ? { ...entryPoint }
    : { ...entryPoint, arguments: [...entryPoint.arguments] };
}
