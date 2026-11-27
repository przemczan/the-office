import type {
  RunEnvironmentOfficeLimits as RunEnvironmentOfficeLimitsResponse,
  RunEnvironmentOfficeLimitsChange,
} from "@the-office/contracts";
import type { OfficeLimitsOnThisComputer } from "../../application/run-environment-office-limits.js";
import type { RunEnvironmentOptions } from "../../domain/run-environment.js";

/** The options a change of the Office limits sets. */
export function toOptions(change: RunEnvironmentOfficeLimitsChange): RunEnvironmentOptions {
  return {
    limits: {
      cpuLimit: { choice: change.cpuLimit, fixedCpus: change.fixedCpus },
      memoryMegabytes: change.memoryMegabytes,
      processes: change.processes,
    },
    runEnvironmentsAtOnce: change.runEnvironmentsAtOnce,
  };
}

/** The limits as Settings reads them, with what Automatic gives on this computer. */
export function toResponse({
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
