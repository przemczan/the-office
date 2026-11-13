import { Injectable } from "@nestjs/common";
import type { SignedInUser } from "../http/signed-in-requests.js";

/**
 * Rewrites a module's records made before users existed, which say only "the user", to name
 * `firstUser`. Idempotent: it changes only rows still lacking a user, so running it again, or after
 * a crash halfway, changes nothing it already did.
 */
export type EarlierRecordsClaim = (firstUser: SignedInUser) => Promise<void>;

/**
 * The registry of every module's claim on its earlier records (spec §2.10: records made before
 * users existed name the first user). Each module `add`s its claim when it starts; the users module
 * runs them all once the first user exists, as migrations can't: no user exists when they run.
 */
@Injectable()
export class EarlierRecords {
  private readonly claims = new Map<string, EarlierRecordsClaim>();

  /** Adds a module's claim under a name of its own, such as `work`. */
  add(name: string, claim: EarlierRecordsClaim): void {
    if (this.claims.has(name)) throw new Error(`The earlier records ${name} are claimed twice.`);
    this.claims.set(name, claim);
  }

  /** Runs every claim, one after another, for `firstUser`. */
  async claimFor(firstUser: SignedInUser): Promise<void> {
    for (const claim of this.claims.values()) await claim(firstUser);
  }
}
