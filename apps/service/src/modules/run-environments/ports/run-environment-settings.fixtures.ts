import {
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  type CpuLimit,
  type RunEnvironmentOptions,
} from "../domain/run-environment.js";
import { RunEnvironmentSettings } from "./run-environment-settings.js";

/** Settings of the test's own: every test file shares the database's one row. */
export class RunEnvironmentSettingsForTests extends RunEnvironmentSettings {
  constructor(private options: RunEnvironmentOptions = DEFAULT_RUN_ENVIRONMENT_OPTIONS) {
    super();
  }

  read(): Promise<RunEnvironmentOptions> {
    return Promise.resolve(this.options);
  }

  change(options: RunEnvironmentOptions): Promise<void> {
    this.options = options;
    return Promise.resolve();
  }

  changeCpuLimit(cpuLimit: CpuLimit): Promise<void> {
    this.options = { ...this.options, limits: { ...this.options.limits, cpuLimit } };
    return Promise.resolve();
  }
}
