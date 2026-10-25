import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { EnvironmentCheck } from "../../domain/environment-check.js";
import { EnvironmentCheckRepository } from "../../ports/environment-check-repository.js";
import { environmentChecks } from "./environment-checks.schema.js";

type EnvironmentCheckRow = typeof environmentChecks.$inferSelect;

@Injectable()
export class PostgresEnvironmentCheckRepository extends EnvironmentCheckRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async save(check: EnvironmentCheck): Promise<void> {
    const row = toRow(check);
    await this.database
      .insert(environmentChecks)
      .values(row)
      .onConflictDoUpdate({ target: environmentChecks.projectId, set: row });
  }

  async find(projectId: string): Promise<EnvironmentCheck | undefined> {
    const [row] = await this.database
      .select()
      .from(environmentChecks)
      .where(eq(environmentChecks.projectId, projectId));
    return row && toEnvironmentCheck(row);
  }
}

function toRow(check: EnvironmentCheck): EnvironmentCheckRow {
  if (check.state === "running" || !check.finishedAt) {
    throw new Error("Only a finished environment check is kept.");
  }
  return {
    projectId: check.projectId,
    environment: check.environment,
    state: check.state,
    checks: [...check.checks],
    startedAt: check.startedAt,
    finishedAt: check.finishedAt,
  };
}

function toEnvironmentCheck(row: EnvironmentCheckRow): EnvironmentCheck {
  return {
    projectId: row.projectId,
    environment: row.environment,
    state: row.state,
    checks: row.checks,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}
