import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  type CpuLimit,
  type RunEnvironmentOptions,
} from "../../domain/run-environment.js";
import { RunEnvironmentSettings } from "../../ports/run-environment-settings.js";
import { runEnvironmentSettings } from "./run-environment-settings.schema.js";

@Injectable()
export class PostgresRunEnvironmentSettings extends RunEnvironmentSettings {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<RunEnvironmentOptions> {
    const [row] = await this.database.select().from(runEnvironmentSettings).limit(1);
    if (row === undefined) return DEFAULT_RUN_ENVIRONMENT_OPTIONS;
    return {
      limits: {
        cpuLimit: { choice: row.cpuLimit, fixedCpus: row.cpus },
        memoryMegabytes: row.memoryMegabytes,
        processes: row.processes,
      },
      runEnvironmentsAtOnce: row.runEnvironmentsAtOnce,
    };
  }

  async change({ limits, runEnvironmentsAtOnce }: RunEnvironmentOptions): Promise<void> {
    const values = {
      cpuLimit: limits.cpuLimit.choice,
      cpus: limits.cpuLimit.fixedCpus,
      memoryMegabytes: limits.memoryMegabytes,
      processes: limits.processes,
      runEnvironmentsAtOnce,
    };
    await this.database
      .insert(runEnvironmentSettings)
      .values(values)
      .onConflictDoUpdate({ target: runEnvironmentSettings.id, set: values });
  }

  async changeCpuLimit({ choice, fixedCpus }: CpuLimit): Promise<void> {
    const { limits, runEnvironmentsAtOnce } = DEFAULT_RUN_ENVIRONMENT_OPTIONS;
    const cpuLimit = { cpuLimit: choice, cpus: fixedCpus };
    await this.database
      .insert(runEnvironmentSettings)
      .values({
        ...cpuLimit,
        memoryMegabytes: limits.memoryMegabytes,
        processes: limits.processes,
        runEnvironmentsAtOnce,
      })
      .onConflictDoUpdate({ target: runEnvironmentSettings.id, set: cpuLimit });
  }
}
