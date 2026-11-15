import type { OfficeUpdateRequest } from "../domain/office-update-request.js";
import type { OfficeUpdateResult } from "../domain/office-update-result.js";

/**
 * The folder the launcher (or the Office updater) and the service share (docs/running-the-office.md): the service writes the
 * request there before it exits for an update, and the launcher leaves the result and its log.
 */
export abstract class UpdateFolder {
  /**
   * Whether the folder is there: the launcher gives it, or a container keeps it in the Office data
   * directory for the Office updater.
   */
  abstract readonly launched: boolean;

  /** The folder's path; undefined when there is none. */
  abstract readonly path: string | undefined;

  /** Asks the launcher or the Office updater for the update. */
  abstract writeRequest(request: OfficeUpdateRequest): Promise<void>;

  /**
   * The result the launcher left of an update since the service last started, kept from then on as
   * the last result; undefined when there is none.
   */
  abstract takeNewResult(): Promise<OfficeUpdateResult | undefined>;

  /** The result of the last update, new or not. */
  abstract lastResult(): Promise<OfficeUpdateResult | undefined>;

  /** The launcher's log of the last update. */
  abstract log(): Promise<string | undefined>;
}
