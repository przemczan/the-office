import {
  groupedOneTimePassword,
  ONE_TIME_PASSWORD_ALPHABET,
  oneTimePasswordAsTyped,
} from "./one-time-password.js";

/**
 * A setup token's length (spec §2.10 Defaults): 24 characters of the one-time password's alphabet,
 * about 119 bits, so it can't be guessed over the network before the first user exists.
 */
export const SETUP_TOKEN_LENGTH = 24;
export const SETUP_TOKEN_ALPHABET = ONE_TIME_PASSWORD_ALPHABET;

/** The setup token as printed, in groups of four: `ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2`. */
export function shownSetupToken(characters: string): string {
  return groupedOneTimePassword(characters);
}

/** A setup token as it is hashed and checked: with or without the dashes, in either case. */
export function setupTokenAsTyped(typed: string): string {
  return oneTimePasswordAsTyped(typed);
}
