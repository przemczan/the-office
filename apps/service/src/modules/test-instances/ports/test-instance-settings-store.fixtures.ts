import { DEFAULT_SETTINGS, type TestInstanceSettings } from "../domain/test-instance-settings.js";
import { TestInstanceSettingsStore } from "./test-instance-settings-store.js";

/** The limits in memory: every test file shares the database's one row. */
export class TestInstanceSettingsForTests extends TestInstanceSettingsStore {
  constructor(public settings: TestInstanceSettings = DEFAULT_SETTINGS) {
    super();
  }

  read(): Promise<TestInstanceSettings> {
    return Promise.resolve(this.settings);
  }

  change(settings: TestInstanceSettings): Promise<void> {
    this.settings = settings;
    return Promise.resolve();
  }
}
