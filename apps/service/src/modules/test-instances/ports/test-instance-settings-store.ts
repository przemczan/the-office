import type { TestInstanceSettings } from "../domain/test-instance-settings.js";

/** The Test instances limits, the defaults until Settings saves others. */
export abstract class TestInstanceSettingsStore {
  abstract read(): Promise<TestInstanceSettings>;

  abstract change(settings: TestInstanceSettings): Promise<void>;
}
