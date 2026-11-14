import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  NO_OFFICE_INSTRUCTIONS,
  type OfficeInstructionsVersion,
} from "../../domain/office-instructions.js";
import type { UserRef } from "../../domain/user.js";
import { OfficeInstructionsRepository } from "../../ports/office-instructions-repository.js";
import { officeInstructionsVersions } from "./office-instructions.schema.js";

const SAVED_VERSION = {
  version: officeInstructionsVersions.version,
  text: officeInstructionsVersions.text,
};

@Injectable()
export class PostgresOfficeInstructionsRepository extends OfficeInstructionsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  current(): Promise<OfficeInstructionsVersion> {
    return newestVersion(this.database);
  }

  async version(version: number): Promise<OfficeInstructionsVersion | undefined> {
    const [row] = await this.database
      .select(SAVED_VERSION)
      .from(officeInstructionsVersions)
      .where(eq(officeInstructionsVersions.version, version));
    return row;
  }

  update(
    change: (current: OfficeInstructionsVersion) => OfficeInstructionsVersion | undefined,
    savedAt: Date,
    savedBy: UserRef,
  ): Promise<OfficeInstructionsVersion> {
    return this.database.transaction(async (transaction) => {
      // There is no row to lock before the first version. Reads, which session starts make, pass.
      await transaction.execute(
        sql`lock table ${officeInstructionsVersions} in share row exclusive mode`,
      );
      const current = await newestVersion(transaction);
      const changed = change(current);
      if (!changed) return current;
      await transaction.insert(officeInstructionsVersions).values({ ...changed, savedAt, savedBy });
      return changed;
    });
  }
}

async function newestVersion(
  database: Pick<Database, "select">,
): Promise<OfficeInstructionsVersion> {
  const [row] = await database
    .select(SAVED_VERSION)
    .from(officeInstructionsVersions)
    .orderBy(desc(officeInstructionsVersions.version))
    .limit(1);
  return row ?? NO_OFFICE_INSTRUCTIONS;
}
