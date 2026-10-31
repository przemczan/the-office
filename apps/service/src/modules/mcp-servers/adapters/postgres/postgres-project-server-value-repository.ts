import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { ProjectServerValue } from "../../domain/project-server-values.js";
import { ProjectServerValueRepository } from "../../ports/project-server-value-repository.js";
import { mcpServers, projectServerValues } from "./mcp-servers.schema.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

@Injectable()
export class PostgresProjectServerValueRepository extends ProjectServerValueRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async ofProject(projectId: string): Promise<readonly ProjectServerValue[]> {
    return this.database
      .select()
      .from(projectServerValues)
      .where(eq(projectServerValues.projectId, projectId))
      .orderBy(asc(projectServerValues.serverName), asc(projectServerValues.name));
  }

  async replace(
    projectId: string,
    serverName: string,
    values: readonly ProjectServerValue[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await lockServer(transaction, serverName);
      await transaction
        .delete(projectServerValues)
        .where(
          and(
            eq(projectServerValues.projectId, projectId),
            eq(projectServerValues.serverName, serverName),
          ),
        );
      if (values.length > 0) await transaction.insert(projectServerValues).values([...values]);
    });
  }

  async updateAll(
    serverName: string,
    keep: (values: readonly ProjectServerValue[]) => readonly ProjectServerValue[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await lockServer(transaction, serverName);
      const kept = await transaction
        .select()
        .from(projectServerValues)
        .where(eq(projectServerValues.serverName, serverName));
      const values = keep(kept);
      await transaction
        .delete(projectServerValues)
        .where(eq(projectServerValues.serverName, serverName));
      if (values.length > 0) await transaction.insert(projectServerValues).values([...values]);
    });
  }
}

/** Holds the server's row, so a Project's change and the server's own never interleave. */
async function lockServer(transaction: Transaction, serverName: string): Promise<void> {
  await transaction
    .select({ name: mcpServers.name })
    .from(mcpServers)
    .where(eq(mcpServers.name, serverName))
    .for("update");
}
