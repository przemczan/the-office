import { ScryptPasswordHashing } from "./scrypt-password-hashing.js";

/**
 * Real scrypt at a cost of 2^10 instead of 2^15, so tests that hash a dozen passwords stay well
 * inside their timeout on a busy machine; `scrypt-password-hashing.test.ts` checks the real cost.
 */
export const quickPasswordHashing = new ScryptPasswordHashing(2 ** 10);
