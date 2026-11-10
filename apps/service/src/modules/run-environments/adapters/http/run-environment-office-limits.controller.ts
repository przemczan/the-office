import { BadRequestException, Body, Controller, Get, Put } from "@nestjs/common";
import {
  runEnvironmentOfficeLimitsChangeSchema,
  type RunEnvironmentOfficeLimits as RunEnvironmentOfficeLimitsResponse,
  type RunEnvironmentOfficeLimitsChange,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import {
  RunEnvironmentOfficeLimits,
  type OfficeLimitsOnThisComputer,
} from "../../application/run-environment-office-limits.js";
import type { RunEnvironmentOptions } from "../../domain/run-environment.js";

/**
 * Settings › Office limits' Run environments card: Run environments at once, and each service's
 * CPUs, memory and processes. The contract keeps the bounds; this computer's cores bound the CPUs.
 */
@Controller("settings/run-environments")
export class RunEnvironmentOfficeLimitsController {
  constructor(private readonly officeLimits: RunEnvironmentOfficeLimits) {}

  @Get()
  async read(): Promise<RunEnvironmentOfficeLimitsResponse> {
    return toResponse(await this.officeLimits.read());
  }

  @Put()
  async change(
    @Body(new ContractPipe(runEnvironmentOfficeLimitsChangeSchema))
    change: RunEnvironmentOfficeLimitsChange,
  ): Promise<RunEnvironmentOfficeLimitsResponse> {
    const options = toOptions(change);
    const problem = this.officeLimits.cpuLimitProblemOf(options.limits.cpuLimit);
    if (problem !== undefined) throw new BadRequestException(`fixedCpus: ${problem}`);
    return toResponse(await this.officeLimits.change(options));
  }
}

function toOptions(change: RunEnvironmentOfficeLimitsChange): RunEnvironmentOptions {
  return {
    limits: {
      cpuLimit: { choice: change.cpuLimit, fixedCpus: change.fixedCpus },
      memoryMegabytes: change.memoryMegabytes,
      processes: change.processes,
    },
    runEnvironmentsAtOnce: change.runEnvironmentsAtOnce,
  };
}

function toResponse({
  options,
  hostCores,
  automatic,
}: OfficeLimitsOnThisComputer): RunEnvironmentOfficeLimitsResponse {
  return {
    runEnvironmentsAtOnce: options.runEnvironmentsAtOnce,
    cpuLimit: options.limits.cpuLimit.choice,
    fixedCpus: options.limits.cpuLimit.fixedCpus,
    memoryMegabytes: options.limits.memoryMegabytes,
    processes: options.limits.processes,
    hostCores,
    automatic: { checksCpus: automatic.checksCpus, otherServicesCpus: automatic.otherServicesCpus },
  };
}
