/**
 * Readies what starts the service again once it exits for a scheduled restart: the launcher, or
 * Docker's restart policy for a container.
 */
export abstract class RestartHandOff {
  /** Throws when nothing would start the service again, which leaves the restart scheduled. */
  abstract handOff(): Promise<void>;
}
