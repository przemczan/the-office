import { createHash, randomInt } from "node:crypto";
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
  normalisedRecoveryCode,
  shownRecoveryCode,
} from "../domain/recovery-code.js";

/** A new set of recovery codes, as the user is shown them once. */
export function newRecoveryCodes(): readonly string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const characters = Array.from(
      { length: RECOVERY_CODE_LENGTH },
      () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)],
    ).join("");
    return shownRecoveryCode(characters);
  });
}

/**
 * A recovery code as kept (spec §6): the SHA-256 of its normalised characters. The codes are random
 * and each is taken once, within the slow-down, so a fast hash is enough.
 */
export function recoveryCodeHashOf(typed: string): string {
  return createHash("sha256").update(normalisedRecoveryCode(typed)).digest("hex");
}
