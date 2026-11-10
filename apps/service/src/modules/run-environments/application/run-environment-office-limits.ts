import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RunEnvironmentSettingsChanged } from "../domain/run-environment-events.js";
import {
  automaticCpusOf,
  cpuLimitProblemOf,
  type AutomaticCpus,
  type CpuLimit,
  type RunEnvironmentOptions,
} from "../domain/run-environment.js";
import { RunEnvironmentSettings } from "../ports/run-environment-settings.js";
import { HostCores } from "./host-cores.js";
import { RunEnvironmentSlots } from "./run-environment-slots.js";

/** The run environments' Office limits as Settings shows them, with what Automatic gives here. */
export interface OfficeLimitsOnThisComputer {
  readonly options: RunEnvironmentOptions;
  readonly hostCores: number;
  readonly automatic: AutomaticCpus;
}

/**
 * The run environments' Office-wide limits (spec §5.5, "Limits"), which Settings changes: Run
 * environments at once, and the CPUs, memory and processes of each run environment's services.
 */
@Injectable()
export class RunEnvironmentOfficeLimits {
  constructor(
    private readonly settings: RunEnvironmentSettings,
    private readonly slots: RunEnvironmentSlots,
    private readonly hostCores: HostCores,
    private readonly events: EventBus,
  ) {}

  async read(): Promise<OfficeLimitsOnThisComputer> {
    return {
      options: await this.settings.read(),
      hostCores: this.hostCores.count,
      automatic: automaticCpusOf(this.hostCores.count),
    };
  }

  /** Why the CPU limit can't be saved on this computer; undefined when it can. */
  cpuLimitProblemOf(cpuLimit: CpuLimit): string | undefined {
    return cpuLimitProblemOf(cpuLimit, this.hostCores.count);
  }

  /**
   * The limits reach no running run environment: each reads them at its next start. A higher Run
   * environments at once lets the waiting start at once.
   */
  async change(options: RunEnvironmentOptions): Promise<OfficeLimitsOnThisComputer> {
    await this.settings.change(options);
    await this.events.publish(new RunEnvironmentSettingsChanged(options));
    await this.slots.admitWaiting();
    return this.read();
  }
}
