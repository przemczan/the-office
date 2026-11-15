import type { FirstRunSetupState } from "../domain/first-run-setup.js";

/**
 * Where First-run setup is kept: one record, the setup token by its hash only. The first user's
 * row and First-run setup after it are saved together by `UserRepository.addFirst`.
 */
export abstract class FirstRunSetupRepository {
  /** `NO_FIRST_RUN_SETUP` while nothing is saved. */
  abstract find(): Promise<FirstRunSetupState>;

  /** Keeps it in place of the one saved. */
  abstract save(setup: FirstRunSetupState): Promise<void>;

  /**
   * Keeps a new token only while none waits, so two starts at once keep one; says whether it did.
   */
  abstract saveTokenIfNoneWaiting(tokenHash: string, at: Date): Promise<boolean>;
}
