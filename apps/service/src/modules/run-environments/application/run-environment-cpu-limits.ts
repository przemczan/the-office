import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RunEnvironmentCpuLimitChanged } from "../domain/run-environment-events.js";
import {
  automaticCpusOf,
  cpuLimitProblemOf,
  type AutomaticCpus,
  type CpuLimit,
} from "../domain/run-environment.js";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";
import { HostCores } from "./host-cores.js";

/** The CPU limit as Settings › Office limits shows it: the choice, and what Automatic gives here. */
export interface CpuLimitOnThisComputer {
  readonly cpuLimit: CpuLimit;
  readonly hostCores: number;
  readonly automatic: AutomaticCpus;
}

/** The run environments' Office-wide CPU limit (spec §5.5, "Limits"), which Settings changes. */
@Injectable()
export class RunEnvironmentCpuLimits {
  constructor(
    private readonly settings: RunEnvironmentSettings,
    private readonly hostCores: HostCores,
    private readonly events: EventBus,
  ) {}

  async read(): Promise<CpuLimitOnThisComputer> {
    const { limits } = await this.settings.read();
    return {
      cpuLimit: limits.cpuLimit,
      hostCores: this.hostCores.count,
      automatic: automaticCpusOf(this.hostCores.count),
    };
  }

  /** Why the CPU limit can't be saved on this computer; undefined when it can. */
  problemOf(cpuLimit: CpuLimit): string | undefined {
    return cpuLimitProblemOf(cpuLimit, this.hostCores.count);
  }

  /** Reaches no running run environment: each reads it at its next start. */
  async change(cpuLimit: CpuLimit): Promise<CpuLimitOnThisComputer> {
    await this.settings.changeCpuLimit(cpuLimit);
    await this.events.publish(new RunEnvironmentCpuLimitChanged(cpuLimit));
    return this.read();
  }
}
