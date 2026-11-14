import { Injectable } from "@nestjs/common";
import { afterWrongTry, NO_WRONG_TRIES, type WrongTries } from "../domain/wrong-tries.js";

/** The most unknown emails whose tries are kept; the longest unused goes first. */
const KEPT_EMAILS = 10_000;

/**
 * Wrong tries at emails no user has, counted as a user's are, so an unknown email gets the same
 * answers as a wrong password, slow-down and lockout included, and never tells which emails The
 * Office knows. Kept in memory, bounded: they guard no account.
 */
@Injectable()
export class UnknownEmailTries {
  private readonly triesByEmail = new Map<string, WrongTries>();

  of(email: string): WrongTries {
    return this.triesByEmail.get(email.trim().toLowerCase()) ?? NO_WRONG_TRIES;
  }

  /** Counts one more wrong try at `now`, and answers the tries after it. */
  countWrong(email: string, now: Date): WrongTries {
    const key = email.trim().toLowerCase();
    const tries = afterWrongTry(this.of(key), now);
    this.triesByEmail.delete(key);
    this.triesByEmail.set(key, tries);
    if (this.triesByEmail.size > KEPT_EMAILS) {
      const longestUnused = this.triesByEmail.keys().next().value;
      if (longestUnused !== undefined) this.triesByEmail.delete(longestUnused);
    }
    return tries;
  }
}
