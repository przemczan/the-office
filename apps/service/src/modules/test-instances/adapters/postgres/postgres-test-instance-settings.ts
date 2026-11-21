import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  DEFAULT_SETTINGS,
  type TestInstanceSettings,
} from "../../domain/test-instance-settings.js";
import { TestInstanceSettingsStore } from "../../ports/test-instance-settings-store.js";
import { testInstanceSettings } from "./test-instances.schema.js";

@Injectable()
export class PostgresTestInstanceSettings extends TestInstanceSettingsStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<TestInstanceSettings> {
    const [row] = await this.database.select().from(testInstanceSettings).limit(1);
    if (row === undefined) return DEFAULT_SETTINGS;
    return {
      testInstancesAtOnce: row.testInstancesAtOnce,
      idleMinutes: row.idleMinutes,
      firstProxyPort: row.firstProxyPort,
      lastProxyPort: row.lastProxyPort,
    };
  }

  async change(settings: TestInstanceSettings): Promise<void> {
    await this.database
      .insert(testInstanceSettings)
      .values(settings)
      .onConflictDoUpdate({ target: testInstanceSettings.id, set: settings });
  }
}
