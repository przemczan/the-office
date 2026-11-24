import { Injectable, Logger } from "@nestjs/common";

/** An Action's last run, as the Project's record (`list_projects`) names it. */
export interface ActionLastRun {
  /**
   * Its state in the user's words, in its kind's own terms (spec §2.15, "States"), such as
   * "Running", "Succeeded", "Failed", "Stopped", "Built" or "Starting".
   */
  readonly state: string;
  readonly startedAt: Date;
}

/** Each Action's last run in a Project, by the Action's key; an Action never run is left out. */
export type ActionLastRunReader = (
  projectId: string,
) => Promise<ReadonlyMap<string, ActionLastRun>>;

/**
 * Each Action's last run, which the Actions module registers a reader for as it starts, so the
 * Project's record names it without Projects calling Actions, which imports Projects. With nothing
 * registered, no Action has a last run.
 */
@Injectable()
export class ActionLastRuns {
  private readonly logger = new Logger(ActionLastRuns.name);
  private reader: ActionLastRunReader | undefined;

  register(reader: ActionLastRunReader): void {
    this.reader = reader;
  }

  /** The Project's Actions' last runs; none when no reader is registered or it throws (logged). */
  async of(projectId: string): Promise<ReadonlyMap<string, ActionLastRun>> {
    if (this.reader === undefined) return new Map();
    try {
      return await this.reader(projectId);
    } catch (error) {
      this.logger.error(
        `Reading the last runs of the Actions of the Project ${projectId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Map();
    }
  }
}
