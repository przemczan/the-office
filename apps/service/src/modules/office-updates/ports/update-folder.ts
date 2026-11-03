import type { OfficeUpdateResult } from "../domain/office-update-result.js";

/**
 * The folder the launcher and the service share (docs/running-the-office.md): the service writes the
 * request there before it exits for an update, and the launcher leaves the result and its log.
 */
export abstract class UpdateFolder {
  /** Whether the service runs under the launcher, which alone carries out an update. */
  abstract readonly launched: boolean;

  /** Asks the launcher to update to `target` once the service exits for it. */
  abstract writeRequest(target: string): Promise<void>;

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
