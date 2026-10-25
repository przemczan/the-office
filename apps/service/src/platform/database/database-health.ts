import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE_POOL } from "./database-pool.js";

export type DatabaseState = "up" | "down";

@Injectable()
export class DatabaseHealth {
  private readonly logger = new Logger(DatabaseHealth.name);

  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async state(): Promise<DatabaseState> {
    try {
      await this.pool.query("select 1");
      return "up";
    } catch (error) {
      this.logger.warn(`The database is down: ${describeError(error)}`);
      return "down";
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
