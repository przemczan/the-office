import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads } from "../../../../platform/database/read-scope.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import type { TestTarget } from "../../domain/test-target.js";
import { TestTargetRepository } from "../../ports/test-target-repository.js";
import { projects } from "./projects.schema.js";
import { storedTestTarget, testTargetOfStored } from "./stored-test-target.js";
import { testTargets } from "./test-targets.schema.js";

@Injectable()
export class PostgresTestTargetRepository extends TestTargetRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async listOf(projectId: string): Promise<readonly TestTarget[]> {
    const rows = await this.database
      .select()
      .from(testTargets)
      .where(eq(testTargets.projectId, projectId))
      .orderBy(asc(testTargets.position));
    return rows.map(testTargetOfStored);
  }

  async update(
    projectId: string,
    change: (targets: readonly TestTarget[]) => Promise<readonly TestTarget[] | undefined>,
  ): Promise<readonly TestTarget[] | undefined> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        // The Project's row holds its targets against another change until this one is saved.
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .for("update");
        if (!project) throw new ProjectNotFound(projectId);
        const rows = await transaction
          .select()
          .from(testTargets)
          .where(eq(testTargets.projectId, projectId))
          .orderBy(asc(testTargets.position));
        const changed = await change(rows.map(testTargetOfStored));
        if (changed === undefined) return undefined;
        await transaction.delete(testTargets).where(eq(testTargets.projectId, projectId));
        if (changed.length > 0) {
          const updatedAt = new Date();
          await transaction.insert(testTargets).values(
            changed.map((target, position) => ({
              projectId,
              ...storedTestTarget(target),
              position,
              updatedAt,
            })),
          );
        }
        return changed;
      }),
    );
  }
}
