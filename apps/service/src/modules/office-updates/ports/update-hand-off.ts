import type { OfficeUpdateRequest } from "../domain/office-update-request.js";

/** How the update goes on once it is handed over. */
export type HandedOff =
  /** The launcher carries it out once the service has stopped. */
  | { readonly serviceStops: true }
  /**
   * The Office updater carries it out while the service runs on until it is replaced; `ended`
   * settles when the updater ends, which, with the service still alive, means it never replaced it.
   */
  | { readonly serviceStops: false; readonly ended: Promise<void> };

/** Hands a scheduled update to what carries it out: the launcher, or the Office updater. */
export abstract class UpdateHandOff {
  /** Throws when the update couldn't be handed over, which leaves it scheduled. */
  abstract handOff(request: OfficeUpdateRequest): Promise<HandedOff>;
}
