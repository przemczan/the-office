import type { RunEnvironmentOptions } from "../domain/run-environment.js";

/** The Office-wide settings of run environments; Settings will edit them. */
export abstract class RunEnvironmentSettings {
  /** The defaults until Settings saves them. */
  abstract read(): Promise<RunEnvironmentOptions>;

  abstract change(options: RunEnvironmentOptions): Promise<void>;
}
