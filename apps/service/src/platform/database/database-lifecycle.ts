import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import type { Pool } from "pg";
import { DATABASE, type Database } from "./database.js";
import { DATABASE_POOL } from "./database-pool.js";
import { runPendingMigrations } from "./migrations.js";

@Injectable()
export class DatabaseLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  // Runs before the service takes requests; a failure stops the start.
  async onModuleInit(): Promise<void> {
    await runPendingMigrations(this.database);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
