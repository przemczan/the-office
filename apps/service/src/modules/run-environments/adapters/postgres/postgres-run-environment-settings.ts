import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
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
      limits: { cpus: row.cpus, memoryMegabytes: row.memoryMegabytes, processes: row.processes },
      runEnvironmentsAtOnce: row.runEnvironmentsAtOnce,
    };
  }

  async change({ limits, runEnvironmentsAtOnce }: RunEnvironmentOptions): Promise<void> {
    const values = { ...limits, runEnvironmentsAtOnce };
    await this.database
      .insert(runEnvironmentSettings)
      .values(values)
      .onConflictDoUpdate({ target: runEnvironmentSettings.id, set: values });
  }
}
