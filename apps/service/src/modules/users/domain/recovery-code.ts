/** How many recovery codes a user gets at a time (spec §2.10 Defaults, "Recovery codes"). */
export const RECOVERY_CODE_COUNT = 10;

/** The characters of a recovery code: digits and capitals without look-alikes (0/O, 1/I/L). */
export const RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const GROUP_LENGTH = 5;
export const RECOVERY_CODE_LENGTH = GROUP_LENGTH * 2;

/** A recovery code as shown: two groups of 5, such as `7KQ2M-XC9RT`. */
export function shownRecoveryCode(characters: string): string {
  return `${characters.slice(0, GROUP_LENGTH)}-${characters.slice(GROUP_LENGTH)}`;
}

/**
 * A typed recovery code as compared: in capitals, without the dash or spaces, so it is taken
 * however it was copied.
 */
export function normalisedRecoveryCode(typed: string): string {
  return typed.replaceAll(/[\s-]/g, "").toUpperCase();
}
