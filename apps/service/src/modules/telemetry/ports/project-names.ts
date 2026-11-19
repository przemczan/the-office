import type { StatsProjectName } from "../domain/full-stats.js";

/** The Projects' names, which the metrics and logs carry; the composition root binds it. */
export abstract class ProjectNames {
  /** The Projects of these ids that The Office knows, with their names now. */
  abstract namesOf(ids: readonly string[]): Promise<readonly StatsProjectName[]>;
}
