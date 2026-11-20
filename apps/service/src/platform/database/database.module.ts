import { Module, type DynamicModule } from "@nestjs/common";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { DATABASE } from "./database.js";
import { DatabaseHealth } from "./database-health.js";
import { DatabaseLifecycle } from "./database-lifecycle.js";
import {
  createDatabasePool,
  DATABASE_POOL,
  DATABASE_QUERY_OBSERVER,
  type DatabaseQueryObserver,
} from "./database-pool.js";

export interface DatabaseOptions {
  readonly url: string;
}

@Module({})
export class DatabaseModule {
  static forRoot({ url }: DatabaseOptions): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: DATABASE_POOL,
          // System health's recorder when the app has it; most tests' apps don't.
          inject: [{ token: DATABASE_QUERY_OBSERVER, optional: true }],
          useFactory: (observer: DatabaseQueryObserver | undefined) =>
            createDatabasePool(url, observer),
        },
        {
          provide: DATABASE,
          inject: [DATABASE_POOL],
          useFactory: (pool: Pool) => drizzle({ client: pool }),
        },
        DatabaseLifecycle,
        DatabaseHealth,
      ],
      exports: [DATABASE, DatabaseHealth],
    };
  }
}
