import { Inject, Injectable } from "@nestjs/common";
import { TransactionRollbackError } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads } from "../../../../platform/database/read-scope.js";
import type { Role } from "../../domain/role.js";
import type { DutyAssignment } from "../../ports/duty-repository.js";
import { OfficeSetupRepository } from "../../ports/office-setup-repository.js";
import { assignDuties } from "./postgres-duty-repository.js";
import { addRole } from "./postgres-role-repository.js";

@Injectable()
export class PostgresOfficeSetupRepository extends OfficeSetupRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async save(
    hired: readonly Role[],
    duties: readonly DutyAssignment[],
    at: Date,
  ): Promise<boolean> {
    try {
      await forgettingReads(() =>
        this.database.transaction(async (transaction) => {
          for (const role of hired) {
            if (!(await addRole(transaction, role))) transaction.rollback();
          }
          await assignDuties(transaction, duties, at);
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof TransactionRollbackError) return false;
      throw error;
    }
  }
}
