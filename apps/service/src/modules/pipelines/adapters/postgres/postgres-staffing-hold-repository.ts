import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { StaffingHoldRepository } from "../../ports/staffing-hold-repository.js";
import { staffingHolds } from "./staffing-holds.schema.js";

@Injectable()
export class PostgresStaffingHoldRepository extends StaffingHoldRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async isHeld(taskId: string): Promise<boolean> {
    const [held] = await this.database
      .select({ taskId: staffingHolds.taskId })
      .from(staffingHolds)
      .where(eq(staffingHolds.taskId, taskId));
    return held !== undefined;
  }

  async hold(taskId: string, decisionId: string): Promise<void> {
    await this.database
      .insert(staffingHolds)
      .values({ taskId, decisionId })
      .onConflictDoUpdate({ target: staffingHolds.taskId, set: { decisionId } });
  }

  async release(decisionId: string): Promise<string | undefined> {
    const [released] = await this.database
      .delete(staffingHolds)
      .where(eq(staffingHolds.decisionId, decisionId))
      .returning({ taskId: staffingHolds.taskId });
    return released?.taskId;
  }
}
