import type { OfficeContainerRead } from "../domain/office-container.js";

/** Where the Office updater finds the update it carries out. */
export interface UpdaterRequest {
  /** The update folder, as a path inside The Office's container. */
  readonly updateFolder: string;
  /** The Office data directory, as a path inside The Office's container. */
  readonly officeDataDirectory: string;
}

/** The Office updater, started and running on its own. */
export interface StartedUpdater {
  /** Settles once the updater's container has ended. */
  readonly ended: Promise<void>;
}

/** The container a Docker Compose install runs The Office's service in, and Docker beside it. */
export abstract class OfficeContainer {
  /** The service's own container: its image, the labels Compose set on it and its mounts. */
  abstract read(): Promise<OfficeContainerRead>;

  /**
   * Starts the Office updater: a short-lived container of the running image that replaces this
   * one through Docker Compose (docs/running-the-office.md). Throws when it can't be started.
   */
  abstract startUpdater(request: UpdaterRequest): Promise<StartedUpdater>;
}
