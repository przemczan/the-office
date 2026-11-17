import type { StatsInitiative } from "../domain/full-stats.js";

/** The Initiatives Work keeps; the composition root binds it. */
export abstract class OfficeInitiatives {
  /** The Initiatives of these ids that The Office knows, with their titles and Projects. */
  abstract titlesOf(ids: readonly string[]): Promise<readonly StatsInitiative[]>;
}
