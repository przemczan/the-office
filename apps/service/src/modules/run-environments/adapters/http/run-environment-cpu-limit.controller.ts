import { BadRequestException, Body, Controller, Get, Put } from "@nestjs/common";
import {
  cpuLimitChangeSchema,
  type CpuLimitChange,
  type RunEnvironmentCpuLimit,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import {
  RunEnvironmentCpuLimits,
  type CpuLimitOnThisComputer,
} from "../../application/run-environment-cpu-limits.js";
import type { CpuLimit } from "../../domain/run-environment.js";

/** Settings › Office limits' Run environments card: the CPU limit. */
@Controller("settings/run-environment-cpu-limit")
export class RunEnvironmentCpuLimitController {
  constructor(private readonly cpuLimits: RunEnvironmentCpuLimits) {}

  @Get()
  async read(): Promise<RunEnvironmentCpuLimit> {
    return toResponse(await this.cpuLimits.read());
  }

  @Put()
  async change(
    @Body(new ContractPipe(cpuLimitChangeSchema)) change: CpuLimitChange,
  ): Promise<RunEnvironmentCpuLimit> {
    const cpuLimit: CpuLimit = { choice: change.cpuLimit, fixedCpus: change.fixedCpus };
    const problem = this.cpuLimits.problemOf(cpuLimit);
    if (problem !== undefined) throw new BadRequestException(`fixedCpus: ${problem}`);
    return toResponse(await this.cpuLimits.change(cpuLimit));
  }
}

function toResponse({
  cpuLimit,
  hostCores,
  automatic,
}: CpuLimitOnThisComputer): RunEnvironmentCpuLimit {
  return {
    cpuLimit: cpuLimit.choice,
    fixedCpus: cpuLimit.fixedCpus,
    hostCores,
    automatic: { checksCpus: automatic.checksCpus, otherServicesCpus: automatic.otherServicesCpus },
  };
}
