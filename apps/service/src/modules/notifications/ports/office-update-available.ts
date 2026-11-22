import type { OfficeUpdateFound } from "../domain/now.js";

/** The Office update the last check found; the composition root binds it. */
export abstract class OfficeUpdateAvailable {
  /** Undefined while none is found, or while an update is scheduled. */
  abstract available(): Promise<OfficeUpdateFound | undefined>;
}
