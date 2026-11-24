import type { ActionSettings } from "../domain/action-settings.js";

/** Actions at once, the default until Settings saves another. */
export abstract class ActionSettingsStore {
  abstract read(): Promise<ActionSettings>;

  abstract change(settings: ActionSettings): Promise<void>;
}
