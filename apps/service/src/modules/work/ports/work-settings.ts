import type { UsageSettings } from "../domain/usage-settings.js";

/** The Office settings Work's rules read; Settings edits them. */
export abstract class WorkSettings {
  /** How many Tasks may be started at once across The Office. */
  abstract officeWideLimit(): Promise<number>;

  abstract changeOfficeWideLimit(officeWideLimit: number): Promise<void>;

  /** The ticked measures and every engine id's caps. */
  abstract usageSettings(): Promise<UsageSettings>;

  /** Keeps the measures and the caps of every engine id in `settings`. */
  abstract changeUsageSettings(settings: UsageSettings): Promise<void>;
}
