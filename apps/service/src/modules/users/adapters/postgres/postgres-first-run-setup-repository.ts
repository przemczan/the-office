import { Inject, Injectable } from "@nestjs/common";
import { isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { NO_FIRST_RUN_SETUP, type FirstRunSetupState } from "../../domain/first-run-setup.js";
import { FirstRunSetupRepository } from "../../ports/first-run-setup-repository.js";
import { firstRunSetup } from "./first-run-setup.schema.js";

/** The one row's values, as `UserRepository.addFirst` writes them too. */
export function firstRunSetupRowOf(setup: FirstRunSetupState): typeof firstRunSetup.$inferInsert {
  return { id: 1, ...setup };
}

@Injectable()
export class PostgresFirstRunSetupRepository extends FirstRunSetupRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(): Promise<FirstRunSetupState> {
    const [row] = await this.database.select().from(firstRunSetup);
    if (row === undefined) return NO_FIRST_RUN_SETUP;
    return {
      setupTokenHash: row.setupTokenHash,
      setupTokenMadeAt: row.setupTokenMadeAt,
      basicsOpenedAt: row.basicsOpenedAt,
      basicsClosedAt: row.basicsClosedAt,
    };
  }

  async save(setup: FirstRunSetupState): Promise<void> {
    await this.database
      .insert(firstRunSetup)
      .values(firstRunSetupRowOf(setup))
      .onConflictDoUpdate({ target: firstRunSetup.id, set: setup });
  }

  async saveTokenIfNoneWaiting(tokenHash: string, at: Date): Promise<boolean> {
    const token = { setupTokenHash: tokenHash, setupTokenMadeAt: at };
    const saved = await this.database
      .insert(firstRunSetup)
      .values({ id: 1, ...token })
      .onConflictDoUpdate({
        target: firstRunSetup.id,
        set: token,
        setWhere: isNull(firstRunSetup.setupTokenHash),
      })
      .returning({ id: firstRunSetup.id });
    return saved.length > 0;
  }
}
