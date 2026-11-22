import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads } from "../../../../platform/database/read-scope.js";
import type { Action } from "../../domain/action.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import { ActionRepository } from "../../ports/action-repository.js";
import { actions } from "./actions.schema.js";
import { projects } from "./projects.schema.js";
import { actionOfStored, storedAction } from "./stored-action.js";

@Injectable()
export class PostgresActionRepository extends ActionRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async listOf(projectId: string): Promise<readonly Action[]> {
    const rows = await this.database
      .select()
      .from(actions)
      .where(eq(actions.projectId, projectId))
      .orderBy(asc(actions.position));
    return rows.map(actionOfStored);
  }

  async update(
    projectId: string,
    change: (stored: readonly Action[]) => Promise<readonly Action[] | undefined>,
  ): Promise<readonly Action[] | undefined> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        // The Project's row holds its Actions against another change until this one is saved.
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .for("update");
        if (!project) throw new ProjectNotFound(projectId);
        const rows = await transaction
          .select()
          .from(actions)
          .where(eq(actions.projectId, projectId))
          .orderBy(asc(actions.position));
        const changed = await change(rows.map(actionOfStored));
        if (changed === undefined) return undefined;
        await transaction.delete(actions).where(eq(actions.projectId, projectId));
        if (changed.length > 0) {
          const updatedAt = new Date();
          await transaction.insert(actions).values(
            changed.map((action, position) => ({
              projectId,
              ...storedAction(action),
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
