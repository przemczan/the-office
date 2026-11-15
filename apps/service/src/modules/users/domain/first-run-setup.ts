/**
 * First-run setup (spec §2.10): the setup token that unlocks the first user, kept only as its
 * SHA-256, then the basics the first user is walked through, open until they finish or skip them.
 */
export interface FirstRunSetupState {
  /** The waiting setup token's hash; null before one is made and once the first user used it up. */
  readonly setupTokenHash: string | null;
  readonly setupTokenMadeAt: Date | null;
  /** When the first user was made and the basics opened; null before. */
  readonly basicsOpenedAt: Date | null;
  readonly basicsClosedAt: Date | null;
}

export type BasicsState = "open" | "closed";

/** An Office that has never made a setup token, such as one that had users before First-run setup. */
export const NO_FIRST_RUN_SETUP: FirstRunSetupState = {
  setupTokenHash: null,
  setupTokenMadeAt: null,
  basicsOpenedAt: null,
  basicsClosedAt: null,
};

export function isTokenWaiting(setup: FirstRunSetupState): boolean {
  return setup.setupTokenHash !== null;
}

/** Open only between the first user and the close: an Office that had users before never opens them. */
export function basicsOf(setup: FirstRunSetupState): BasicsState {
  return setup.basicsOpenedAt !== null && setup.basicsClosedAt === null ? "open" : "closed";
}

/** A new token in place of any waiting one, which ends. */
export function withSetupToken(
  setup: FirstRunSetupState,
  tokenHash: string,
  at: Date,
): FirstRunSetupState {
  return { ...setup, setupTokenHash: tokenHash, setupTokenMadeAt: at };
}

/**
 * Once the first user is made: the token is used up and the basics open, or are closed at once
 * when the install skips them.
 */
export function afterFirstUser(
  setup: FirstRunSetupState,
  at: Date,
  skipBasics: boolean,
): FirstRunSetupState {
  return {
    ...setup,
    setupTokenHash: null,
    basicsOpenedAt: at,
    basicsClosedAt: skipBasics ? at : null,
  };
}

export function withBasicsClosed(setup: FirstRunSetupState, at: Date): FirstRunSetupState {
  return { ...setup, basicsClosedAt: setup.basicsClosedAt ?? at };
}
