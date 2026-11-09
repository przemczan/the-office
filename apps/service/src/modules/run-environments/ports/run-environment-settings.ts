import type { CpuLimit, RunEnvironmentOptions } from "../domain/run-environment.js";

/** The Office-wide settings of run environments; Settings edits the CPU limit. */
export abstract class RunEnvironmentSettings {
  /** The defaults until Settings saves them. */
  abstract read(): Promise<RunEnvironmentOptions>;

  abstract change(options: RunEnvironmentOptions): Promise<void>;

  /** Keeps the other settings as they are, the defaults if none were saved. */
  abstract changeCpuLimit(cpuLimit: CpuLimit): Promise<void>;
}
