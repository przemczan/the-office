import type { StatsTask } from "../domain/basic-stats.js";

/** The Tasks Work keeps; the composition root binds it. */
export abstract class OfficeTasks {
  /** The Tasks that moved to Done at or after `since`, each once. */
  abstract doneSince(since: Date): Promise<readonly string[]>;
  /** The Tasks of these ids that The Office knows, archived ones too. */
  abstract findAll(ids: readonly string[]): Promise<readonly StatsTask[]>;
}
