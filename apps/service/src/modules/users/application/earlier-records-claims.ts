import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EarlierRecords } from "../../../platform/earlier-records/earlier-records.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { UserRepository } from "../ports/user-repository.js";

/**
 * Gives records made before users existed to the first user (spec §2.10): right after the first
 * user is created, and at each start until a run has finished, so a crash halfway is made good at
 * the next start. Once finished, never again: the claims are idempotent, but some scan a lot.
 */
@Injectable()
export class EarlierRecordsClaims implements OnApplicationBootstrap {
  private readonly logger = new Logger(EarlierRecordsClaims.name);

  constructor(
    private readonly users: UserRepository,
    private readonly earlierRecords: EarlierRecords,
    private readonly schedule: Schedule,
  ) {}

  // Every module added its claim in its own init, which ran before this.
  onApplicationBootstrap(): Promise<void> {
    return this.claimIfDue();
  }

  /**
   * Runs every claim for the first user, unless done before or no user exists yet. A failure is
   * logged, never thrown: the next start tries again.
   */
  async claimIfDue(): Promise<void> {
    try {
      if (await this.users.earlierRecordsClaimed()) return;
      const firstUser = await this.users.first();
      if (firstUser === undefined) return;
      await this.earlierRecords.claimFor({ userId: firstUser.id, name: firstUser.name });
      await this.users.markEarlierRecordsClaimed(this.schedule.now());
    } catch (error) {
      this.logger.error(
        "Giving earlier records to the first user failed; the next start tries again.",
        error,
      );
    }
  }
}
